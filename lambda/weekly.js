import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { createCraftClient } from "./craft.js";
import { createLineClient, EMPTY_WEEK_MESSAGE, fitLineText } from "./line.js";
import { loadCredentials, settingsFromEnv } from "./index.js";
import { combineNotes } from "./summary-prompt.js";
import { createSummarizer } from "./summarize.js";

const TOKYO = "Asia/Tokyo";

export function tokyoDate(now = new Date(), timeZone = TOKYO) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function createdSinceDate(now = new Date(), timeZone = TOKYO) {
  const [year, month, day] = tokyoDate(now, timeZone).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 7);
  return date.toISOString().slice(0, 10);
}

export function weeklySettingsFromEnv(env = process.env) {
  return {
    ...settingsFromEnv(env),
    sourceFolderName: env.CRAFT_SOURCE_FOLDER_NAME || "daily_note_transcribe",
    processedFolderName: env.CRAFT_PROCESSED_FOLDER_NAME || "processed",
    summaryFolderName: env.CRAFT_SUMMARY_FOLDER_NAME || "daily_note_summaries",
  };
}

export async function loadWeeklyCredentials(settings, secretsClient) {
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

export async function processWeekly({
  documents,
  readMarkdown,
  summarize,
  pushLine,
  ensureSummaryFolder,
  createDocument,
  moveDocuments,
  now = new Date(),
}) {
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

export async function handler() {
  console.log("start");
  try {
    return await runWeekly();
  } finally {
    console.log("end");
  }
}

async function runWeekly() {
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
  return summary;
}
