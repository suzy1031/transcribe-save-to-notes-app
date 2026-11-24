import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { formatWeeklyUsage, getWeeklyUsage } from "../claude/claude-usage.ts";
import { fetchUsdJpyRate } from "../claude/fx-rate.ts";
import type { WeeklyUsageItem } from "../claude/types.ts";
import { EMPTY_WEEK_MESSAGE, fitLineText } from "../line/helper.ts";
import { createLineClient } from "../line/line.ts";
import { createObsidianClient } from "../obsidian/obsidian.ts";
import type { ObsidianListedNote } from "../obsidian/types.ts";
import { bunLambdaHandler } from "../shared/bun-handler.ts";
import {
  DEFAULT_OBSIDIAN_DAILY_FOLDER,
  DEFAULT_OBSIDIAN_SUMMARY_FOLDER,
  TOKYO_TIME_ZONE,
  WEEKLY_LOOKBACK_DAYS,
} from "../shared/const.ts";
import { runLogged } from "../shared/job.ts";
import { sanitizeErrorMessage } from "../shared/sanitize-error.ts";
import { loadCredentials, settingsFromEnv } from "../shared/settings.ts";
import { daysBeforeTokyoDate, tokyoDate } from "../shared/tokyo-date.ts";
import type { Credentials, SecretsClientLike } from "../shared/types.ts";
import { createSummarizer } from "../summarize/summarize.ts";
import { combineNotes } from "../summarize/summary-prompt.ts";
import type { WeeklySummaryOutput } from "../summarize/types.ts";
import type { WeeklySettings } from "./types.ts";

export function createdSinceDate(now: Date = new Date(), timeZone: string = TOKYO_TIME_ZONE): string {
  return daysBeforeTokyoDate(now, WEEKLY_LOOKBACK_DAYS, timeZone);
}

export function weeklySettingsFromEnv(env: NodeJS.ProcessEnv = process.env): WeeklySettings {
  return {
    ...settingsFromEnv(env),
    sourceFolderName: env.OBSIDIAN_DAILY_FOLDER || DEFAULT_OBSIDIAN_DAILY_FOLDER,
    summaryFolderName: env.OBSIDIAN_SUMMARY_FOLDER || DEFAULT_OBSIDIAN_SUMMARY_FOLDER,
  };
}

export async function loadWeeklyCredentials(
  settings: WeeklySettings,
  secretsClient: SecretsClientLike,
): Promise<Credentials> {
  if (settings.secretId) return loadCredentials(settings, secretsClient);
  return {
    anthropicApiKey: settings.anthropicApiKey,
    lineChannelAccessToken: settings.lineChannelAccessToken,
    lineUserId: settings.lineUserId,
  };
}

export async function reportWeeklyUsage({
  getUsage,
  getUsdJpyRate = fetchUsdJpyRate,
  pushLine,
  log = console.log,
}: {
  getUsage: () => Promise<WeeklyUsageItem | null>;
  getUsdJpyRate?: () => Promise<number | null>;
  pushLine?: (text: string) => Promise<void>;
  log?: (text: string) => void;
}): Promise<{ item: WeeklyUsageItem | null; text: string }> {
  const item = await getUsage();
  let usdJpyRate: number | null = null;
  if (item) {
    try {
      usdJpyRate = await getUsdJpyRate();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`為替レート取得に失敗: ${sanitizeErrorMessage(message)}`);
    }
  }
  const text = formatWeeklyUsage(item, usdJpyRate);
  log(text);
  if (item && pushLine) await pushLine(text);
  return { item, text };
}

export async function processWeekly({
  documents,
  readMarkdown,
  summarize,
  pushLine,
  saveSummaryNote,
  now = new Date(),
}: {
  documents: ReadonlyArray<Pick<ObsidianListedNote, "id" | "title">>;
  readMarkdown: (id: string) => Promise<string>;
  summarize: (notesText: string) => Promise<WeeklySummaryOutput>;
  pushLine: (text: string) => Promise<void>;
  saveSummaryNote: (input: { title: string; markdown: string; date: string }) => Promise<string>;
  now?: Date;
}): Promise<{ summarized: number }> {
  if (documents.length === 0) {
    await pushLine(EMPTY_WEEK_MESSAGE);
    return { summarized: 0 };
  }

  const notes = [];
  for (const document of documents) {
    notes.push({ title: document.title, markdown: await readMarkdown(document.id) });
  }
  const summary = await summarize(combineNotes(notes));
  await pushLine(fitLineText(summary.lineSummary));
  const today = tokyoDate(now);
  await saveSummaryNote({
    title: `週次まとめ ${today}`,
    markdown: summary.obsidianMarkdown,
    date: today,
  });
  return { summarized: documents.length };
}

export async function handler(): Promise<{ summarized: number }> {
  return runLogged(() => runWeekly());
}

async function runWeekly(): Promise<{ summarized: number }> {
  const settings = weeklySettingsFromEnv();
  const credentials = await loadWeeklyCredentials(
    settings,
    new SecretsManagerClient({ region: settings.bedrockRegion }),
  );
  const obsidian = createObsidianClient({
    bucketName: settings.notesBucketName,
    region: settings.bedrockRegion,
  });
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
  const documents = await obsidian.listNotes({
    folder: settings.sourceFolderName,
    createdDateGte: createdSinceDate(now),
  });
  const summary = await processWeekly({
    documents,
    readMarkdown: (id) => obsidian.readMarkdown(id),
    summarize,
    pushLine: (text) => line.push(text),
    saveSummaryNote: ({ title, markdown, date }) =>
      obsidian.createNote({
        folder: settings.summaryFolderName,
        title,
        markdown,
        date,
        tags: ["weekly-summary"],
      }),
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

export default bunLambdaHandler(handler);
