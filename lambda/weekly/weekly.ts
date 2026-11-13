import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { formatWeeklyUsage, getWeeklyUsage } from "../claude/claude-usage.ts";
import type { WeeklyUsageItem } from "../claude/types.ts";
import { createCraftClient } from "../craft/craft.ts";
import type { CraftListedDocument } from "../craft/types.ts";
import { loadCredentials, settingsFromEnv } from "../inbox/index.ts";
import { EMPTY_WEEK_MESSAGE, fitLineText } from "../line/helper.ts";
import { createLineClient } from "../line/line.ts";
import {
  DEFAULT_CRAFT_PROCESSED_FOLDER,
  DEFAULT_CRAFT_SUMMARY_FOLDER,
  DEFAULT_CRAFT_TRANSCRIBE_FOLDER,
  TOKYO_TIME_ZONE,
  WEEKLY_LOOKBACK_DAYS,
} from "../shared/const.ts";
import { sanitizeErrorMessage } from "../shared/sanitize-error.ts";
import type { Credentials, SecretsClientLike } from "../shared/types.ts";
import { createSummarizer } from "../summarize/summarize.ts";
import { combineNotes } from "../summarize/summary-prompt.ts";
import type { WeeklySettings } from "./types.ts";

export function tokyoDate(now: Date = new Date(), timeZone: string = TOKYO_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function daysBeforeTokyoDate(
  now: Date = new Date(),
  days: number = WEEKLY_LOOKBACK_DAYS,
  timeZone: string = TOKYO_TIME_ZONE,
): string {
  const [year, month, day] = tokyoDate(now, timeZone).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function createdSinceDate(now: Date = new Date(), timeZone: string = TOKYO_TIME_ZONE): string {
  return daysBeforeTokyoDate(now, WEEKLY_LOOKBACK_DAYS, timeZone);
}

export function weeklySettingsFromEnv(env: NodeJS.ProcessEnv = process.env): WeeklySettings {
  return {
    ...settingsFromEnv(env),
    sourceFolderName: env.CRAFT_SOURCE_FOLDER_NAME || DEFAULT_CRAFT_TRANSCRIBE_FOLDER,
    processedFolderName: env.CRAFT_PROCESSED_FOLDER_NAME || DEFAULT_CRAFT_PROCESSED_FOLDER,
    summaryFolderName: env.CRAFT_SUMMARY_FOLDER_NAME || DEFAULT_CRAFT_SUMMARY_FOLDER,
  };
}

export async function loadWeeklyCredentials(
  settings: WeeklySettings,
  secretsClient: SecretsClientLike,
): Promise<Credentials> {
  if (settings.secretId) return loadCredentials(settings, secretsClient);
  if (!settings.craftApiBaseUrl || !settings.craftApiKey) {
    throw new Error("SECRET_ID or local Craft credentials are required");
  }
  return {
    craftApiBaseUrl: settings.craftApiBaseUrl,
    craftApiKey: settings.craftApiKey,
    anthropicApiKey: settings.anthropicApiKey,
    lineChannelAccessToken: settings.lineChannelAccessToken,
    lineUserId: settings.lineUserId,
  };
}

export async function reportWeeklyUsage({
  getUsage,
  pushLine,
  log = console.log,
}: {
  getUsage: () => Promise<WeeklyUsageItem | null>;
  pushLine?: (text: string) => Promise<void>;
  log?: (text: string) => void;
}): Promise<{ item: WeeklyUsageItem | null; text: string }> {
  const item = await getUsage();
  const text = formatWeeklyUsage(item);
  log(text);
  if (item && pushLine) await pushLine(text);
  return { item, text };
}

export async function processWeekly({
  documents,
  readMarkdown,
  summarize,
  pushLine,
  ensureSummaryFolder,
  createDocument,
  moveDocuments,
  now = new Date(),
}: {
  documents: ReadonlyArray<CraftListedDocument>;
  readMarkdown: (id: string) => Promise<string>;
  summarize: (notesText: string) => Promise<string>;
  pushLine: (text: string) => Promise<void>;
  ensureSummaryFolder: () => Promise<string>;
  createDocument: (input: { title: string; markdown: string; folderId: string }) => Promise<string>;
  moveDocuments: (documentIds: string[]) => Promise<void>;
  now?: Date;
}): Promise<{ summarized: number; moved: number }> {
  if (documents.length === 0) {
    await pushLine(EMPTY_WEEK_MESSAGE);
    return { summarized: 0, moved: 0 };
  }

  const notes = [];
  for (const document of documents) {
    notes.push({ title: document.title, markdown: await readMarkdown(document.id) });
  }
  const summary = await summarize(combineNotes(notes));
  await pushLine(fitLineText(summary));
  const folderId = await ensureSummaryFolder();
  await createDocument({
    title: `週次まとめ ${tokyoDate(now)}`,
    markdown: summary,
    folderId,
  });
  await moveDocuments(documents.map((document) => document.id));
  return { summarized: documents.length, moved: documents.length };
}

export async function handler(): Promise<{ summarized: number; moved: number }> {
  console.log("start");
  try {
    return await runWeekly();
  } finally {
    console.log("end");
  }
}

async function runWeekly(): Promise<{ summarized: number; moved: number }> {
  const settings = weeklySettingsFromEnv();
  const credentials = await loadWeeklyCredentials(
    settings,
    new SecretsManagerClient({ region: settings.bedrockRegion }),
  );
  const craft = createCraftClient({
    baseUrl: credentials.craftApiBaseUrl,
    apiKey: credentials.craftApiKey,
  });
  const sourceFolderId = await craft.findFolder(settings.sourceFolderName);
  if (!sourceFolderId) {
    throw new Error(`Craft folder "${settings.sourceFolderName}" was not found`);
  }
  const line = createLineClient({
    channelAccessToken: credentials.lineChannelAccessToken,
    userId: credentials.lineUserId,
  });
  const summarize = createSummarizer({
    provider: settings.transcriptionProvider,
    claude: {
      apiKey: credentials.anthropicApiKey,
      modelId: settings.claudeModelId,
    },
    bedrock: {
      region: settings.bedrockRegion,
      modelId: settings.bedrockModelId,
    },
  });
  const now = new Date();
  const documents = await craft.listDocuments({
    folderId: sourceFolderId,
    createdDateGte: createdSinceDate(now),
  });
  const summary = await processWeekly({
    documents,
    readMarkdown: (id) => craft.readMarkdown(id),
    summarize,
    pushLine: (text) => line.push(text),
    ensureSummaryFolder: () => craft.ensureFolder(settings.summaryFolderName),
    createDocument: (input) => craft.createDocument(input),
    moveDocuments: async (documentIds) => {
      const processedFolderId = await craft.ensureFolder(settings.processedFolderName);
      await craft.moveDocuments({ documentIds, folderId: processedFolderId });
    },
    now,
  });
  console.log(`週次要約 ${summary.summarized}件`);
  try {
    await reportWeeklyUsage({
      getUsage: () => getWeeklyUsage({ now }),
      pushLine: (text) => line.push(text),
    });
  } catch (error) {
    console.error(`Claude利用量の参照に失敗: ${sanitizeErrorMessage((error as Error).message)}`);
  }
  return summary;
}
