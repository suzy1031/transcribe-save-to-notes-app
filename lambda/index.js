import { readFile } from "node:fs/promises";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { createCraftClient } from "./craft.js";
import { createDriveClient } from "./drive.js";
import { createTranscription, MAX_IMAGE_BYTES } from "./transcribe/index.js";

const INBOX_FOLDER_NAME = "00_notes_inbox";
const PROCESSED_FOLDER_NAME = "01_processed";
const MIN_REMAINING_MS = 60_000;

export function settingsFromEnv(env = process.env) {
  return {
    secretId: env.SECRET_ID ?? "",
    bedrockModelId: env.BEDROCK_MODEL_ID || "amazon.nova-lite-v1:0",
    bedrockRegion: env.BEDROCK_REGION || env.AWS_REGION || "ap-northeast-1",
    craftFolderName: env.CRAFT_FOLDER_NAME || "daily_note_transcribe",
    craftApiBaseUrl: env.CRAFT_API_BASE_URL ?? "",
    craftApiKey: env.CRAFT_API_KEY ?? "",
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? "",
    claudeModelId: env.CLAUDE_MODEL_ID || "claude-haiku-5-5",
    transcriptionProvider: env.TRANSCRIPTION_PROVIDER || "claude",
    googleServiceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "",
  };
}

export async function loadCredentials(settings, secretsClient) {
  if (settings.secretId) {
    const output = await secretsClient.send(
      new GetSecretValueCommand({ SecretId: settings.secretId }),
    );
    const parsed = JSON.parse(output.SecretString ?? "");
    return {
      serviceAccount: parsed.googleServiceAccount,
      craftApiBaseUrl: parsed.craftApiBaseUrl,
      craftApiKey: parsed.craftApiKey,
      anthropicApiKey: parsed.anthropicApiKey,
    };
  }
  if (!settings.googleServiceAccountJson || !settings.craftApiBaseUrl || !settings.craftApiKey) {
    throw new Error("SECRET_ID or local Google and Craft credentials are required");
  }
  const raw = settings.googleServiceAccountJson.trim().startsWith("{")
    ? settings.googleServiceAccountJson
    : await readFile(settings.googleServiceAccountJson, "utf8");
  return {
    serviceAccount: JSON.parse(raw),
    craftApiBaseUrl: settings.craftApiBaseUrl,
    craftApiKey: settings.craftApiKey,
    anthropicApiKey: settings.anthropicApiKey,
  };
}

export async function processInbox({
  files,
  download,
  transcribe,
  ensureFolder,
  createDocument,
  moveToProcessed,
  getRemainingTimeMs = () => Number.POSITIVE_INFINITY,
  maxImageBytes = MAX_IMAGE_BYTES,
  log = console,
}) {
  const summary = { processed: 0, failed: 0, skipped: 0, deferred: 0 };
  if (files.length === 0) {
    log.info("画像ファイル取得なし");
    return summary;
  }

  const folderId = await ensureFolder();

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (getRemainingTimeMs() < MIN_REMAINING_MS) {
      summary.deferred += files.length - index;
      log.info(`Deferred ${summary.deferred} file(s): remaining time is under 60 seconds`);
      break;
    }
    let stage = "画像ファイル取得";
    try {
      const existingId = file.appProperties?.craftDocumentId;
      if (existingId) {
        log.info(`画像ファイル取得成功 ${file.name}`);
        await moveToProcessed({ file, craftDocumentId: existingId });
        summary.processed += 1;
        continue;
      }
      const bytes = await download(file);
      log.info(`画像ファイル取得成功 ${file.name}`);
      if (bytes.byteLength > maxImageBytes) {
        summary.skipped += 1;
        log.error(`Skipped ${file.name}: image exceeds the size limit`);
        continue;
      }
      stage = "文字起こし";
      log.info(`文字起こし start ${file.name}`);
      const note = await transcribe({ bytes, mimeType: file.mimeType });
      log.info(`文字起こし end ${file.name}`);
      stage = "craft保存";
      log.info(`craft保存 start ${file.name}`);
      const craftDocumentId = await createDocument({
        title: note.title,
        markdown: note.markdown,
        folderId,
      });
      log.info(`craft保存 end ${file.name}`);
      stage = "移動";
      await moveToProcessed({ file, craftDocumentId });
      summary.processed += 1;
    } catch (error) {
      summary.failed += 1;
      if (stage === "画像ファイル取得") {
        log.error(`画像ファイル取得失敗 ${file.name}: ${error.message}`);
      } else if (stage === "移動") {
        log.error(`移動失敗 ${file.name}: ${error.message}`);
      } else {
        log.error(`${stage}失敗 ${file.name}: ${error.message}`);
        log.info(`${stage} end ${file.name}`);
      }
    }
  }
  return summary;
}

export async function handler(event, context) {
  console.log("start");
  try {
    return await runPipeline(context);
  } finally {
    console.log("end");
  }
}

async function runPipeline(context) {
  const settings = settingsFromEnv();
  const credentials = await loadCredentials(
    settings,
    new SecretsManagerClient({ region: settings.bedrockRegion }),
  );
  const drive = createDriveClient({ serviceAccount: credentials.serviceAccount });
  const inbox = await drive.findUniqueFolder(INBOX_FOLDER_NAME);
  const processed = await drive.findUniqueFolder(PROCESSED_FOLDER_NAME);
  if (!inbox.ok || !processed.ok) {
    const inboxCount = inbox.ok ? 1 : inbox.count;
    const processedCount = processed.ok ? 1 : processed.count;
    console.error(`画像ファイル取得失敗 inbox=${inboxCount} processed=${processedCount}`);
    return { processed: 0, failed: 0, skipped: 0, deferred: 0, folderLookup: "failed" };
  }

  const files = await drive.listImages(inbox.id);
  const craft = createCraftClient({
    baseUrl: credentials.craftApiBaseUrl,
    apiKey: credentials.craftApiKey,
  });
  const transcription = createTranscription({
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

  return processInbox({
    files,
    download: (file) => drive.download(file.id),
    transcribe: transcription.transcribe,
    maxImageBytes: transcription.maxImageBytes,
    ensureFolder: () => craft.ensureFolder(settings.craftFolderName),
    createDocument: (input) => craft.createDocument(input),
    moveToProcessed: ({ file, craftDocumentId }) =>
      drive.moveToProcessed({
        fileId: file.id,
        inboxFolderId: inbox.id,
        processedFolderId: processed.id,
        craftDocumentId,
      }),
    getRemainingTimeMs: () => context.getRemainingTimeInMillis(),
  });
}
