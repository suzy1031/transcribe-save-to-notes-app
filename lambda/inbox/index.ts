import { readFile } from "node:fs/promises";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { createCraftClient } from "../craft/craft.ts";
import { connectionSpaceId, craftAppDocumentLink } from "../craft/helper.ts";
import { createDriveClient } from "../drive/drive.ts";
import { fileStem, orphanTextFiles } from "../drive/helper.ts";
import type { DriveClient, DriveFile, GoogleServiceAccount } from "../drive/types.ts";
import { transcriptionFailedMessage, transcriptionSavedMessage } from "../line/helper.ts";
import { createLineClient } from "../line/line.ts";
import type { LineClient } from "../line/types.ts";
import {
  DEFAULT_AWS_REGION,
  DEFAULT_BEDROCK_MODEL_ID,
  DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID,
  DEFAULT_CRAFT_TRANSCRIBE_FOLDER,
  DEFAULT_TRANSCRIPTION_PROVIDER,
  INBOX_FOLDER_NAME,
  MIN_REMAINING_MS,
  PROCESSED_DRIVE_FOLDER_NAME,
} from "../shared/const.ts";
import { sanitizeErrorMessage } from "../shared/sanitize-error.ts";
import type { BaseSettings, Credentials, LambdaContextLike, LoggerLike, SecretsClientLike } from "../shared/types.ts";
import { createTranscription, MAX_IMAGE_BYTES } from "../transcribe/index.ts";
import type { ParsedTranscription, TranscribeInput } from "../transcribe/types.ts";
import type { ProcessInboxSummary } from "./types.ts";

export function settingsFromEnv(env: NodeJS.ProcessEnv = process.env): BaseSettings {
  return {
    secretId: env.SECRET_ID ?? "",
    bedrockModelId: env.BEDROCK_MODEL_ID || DEFAULT_BEDROCK_MODEL_ID,
    bedrockRegion: env.BEDROCK_REGION || env.AWS_REGION || DEFAULT_AWS_REGION,
    craftFolderName: env.CRAFT_FOLDER_NAME || DEFAULT_CRAFT_TRANSCRIBE_FOLDER,
    craftApiBaseUrl: env.CRAFT_API_BASE_URL ?? "",
    craftApiKey: env.CRAFT_API_KEY ?? "",
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? "",
    claudeModelId: env.CLAUDE_MODEL_ID || DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID,
    transcriptionProvider: env.TRANSCRIPTION_PROVIDER || DEFAULT_TRANSCRIPTION_PROVIDER,
    googleServiceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "",
    lineChannelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
    lineUserId: env.LINE_USER_ID ?? "",
  };
}

export async function loadCredentials(settings: BaseSettings, secretsClient: SecretsClientLike): Promise<Credentials> {
  if (settings.secretId) {
    const output = await secretsClient.send(new GetSecretValueCommand({ SecretId: settings.secretId }));
    const parsed = JSON.parse(output.SecretString ?? "") as {
      googleServiceAccount?: GoogleServiceAccount;
      craftApiBaseUrl: string;
      craftApiKey: string;
      anthropicApiKey?: string;
      lineChannelAccessToken?: string;
      lineUserId?: string;
    };
    return {
      serviceAccount: parsed.googleServiceAccount,
      craftApiBaseUrl: parsed.craftApiBaseUrl,
      craftApiKey: parsed.craftApiKey,
      anthropicApiKey: parsed.anthropicApiKey,
      lineChannelAccessToken: parsed.lineChannelAccessToken ?? "",
      lineUserId: parsed.lineUserId ?? "",
    };
  }
  if (!settings.googleServiceAccountJson || !settings.craftApiBaseUrl || !settings.craftApiKey) {
    throw new Error("SECRET_ID or local Google and Craft credentials are required");
  }
  const raw = settings.googleServiceAccountJson.trim().startsWith("{")
    ? settings.googleServiceAccountJson
    : await readFile(settings.googleServiceAccountJson, "utf8");
  return {
    serviceAccount: JSON.parse(raw) as GoogleServiceAccount,
    craftApiBaseUrl: settings.craftApiBaseUrl,
    craftApiKey: settings.craftApiKey,
    anthropicApiKey: settings.anthropicApiKey,
    lineChannelAccessToken: settings.lineChannelAccessToken ?? "",
    lineUserId: settings.lineUserId ?? "",
  };
}

export async function processInbox({
  files,
  download,
  transcribe,
  ensureFolder,
  createDocument,
  moveToProcessed,
  removeTextFiles = async () => {},
  notifySaved = async () => {},
  notifyFailed = async () => {},
  getRemainingTimeMs = () => Number.POSITIVE_INFINITY,
  maxImageBytes = MAX_IMAGE_BYTES,
  log = console,
}: {
  files: ReadonlyArray<DriveFile>;
  download: (file: DriveFile) => Promise<Uint8Array | Buffer>;
  transcribe: (input: TranscribeInput) => Promise<ParsedTranscription>;
  ensureFolder: () => Promise<string>;
  createDocument: (input: { title: string; markdown: string; folderId: string }) => Promise<string>;
  moveToProcessed: (input: { file: DriveFile; craftDocumentId: string }) => Promise<void>;
  removeTextFiles?: (file: DriveFile) => Promise<void>;
  notifySaved?: (input: { title: string; documentId: string }) => Promise<void>;
  notifyFailed?: (input: { fileName: string; reason: string }) => Promise<void>;
  getRemainingTimeMs?: () => number;
  maxImageBytes?: number;
  log?: LoggerLike;
}): Promise<ProcessInboxSummary> {
  const summary: ProcessInboxSummary = { processed: 0, failed: 0, skipped: 0, deferred: 0 };
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
        await removeTextFiles(file);
        summary.processed += 1;
        continue;
      }
      const listedSize = file.size != null && file.size !== "" ? Number(file.size) : Number.NaN;
      if (Number.isFinite(listedSize) && listedSize > maxImageBytes) {
        summary.skipped += 1;
        log.error(`Skipped ${file.name}: image exceeds the size limit`);
        await notifyFailed({ fileName: file.name, reason: "image exceeds the size limit" });
        continue;
      }
      const bytes = await download(file);
      log.info(`画像ファイル取得成功 ${file.name}`);
      if (bytes.byteLength > maxImageBytes) {
        summary.skipped += 1;
        log.error(`Skipped ${file.name}: image exceeds the size limit`);
        await notifyFailed({ fileName: file.name, reason: "image exceeds the size limit" });
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
      await removeTextFiles(file);
      summary.processed += 1;
      await notifySaved({ title: note.title, documentId: craftDocumentId });
    } catch (error) {
      summary.failed += 1;
      const err = error as Error;
      const message = sanitizeErrorMessage(err.message);
      if (stage === "画像ファイル取得") {
        log.error(`画像ファイル取得失敗 ${file.name}: ${message}`);
      } else if (stage === "移動") {
        log.error(`移動失敗 ${file.name}: ${message}`);
      } else {
        log.error(`${stage}失敗 ${file.name}: ${message}`);
        log.info(`${stage} end ${file.name}`);
      }
      await notifyFailed({ fileName: file.name, reason: message });
    }
  }
  return summary;
}

export async function handler(event: unknown, context: LambdaContextLike): Promise<ProcessInboxSummary> {
  console.log("start");
  try {
    return await runPipeline(context);
  } finally {
    console.log("end");
  }
}

async function runPipeline(context: LambdaContextLike): Promise<ProcessInboxSummary> {
  const settings = settingsFromEnv();
  const credentials = await loadCredentials(settings, new SecretsManagerClient({ region: settings.bedrockRegion }));
  const drive = createDriveClient({ serviceAccount: credentials.serviceAccount });
  const inbox = await drive.findUniqueFolder(INBOX_FOLDER_NAME);
  const processed = await drive.findUniqueFolder(PROCESSED_DRIVE_FOLDER_NAME);
  const notify = createLineNotifier(credentials);
  if (!inbox.ok || !processed.ok) {
    const inboxCount = inbox.ok ? 1 : inbox.count;
    const processedCount = processed.ok ? 1 : processed.count;
    const reason = `Drive folder lookup failed: inbox=${inboxCount} processed=${processedCount}`;
    console.error(`画像ファイル取得失敗 inbox=${inboxCount} processed=${processedCount}`);
    await notify.failed({ fileName: "inbox", reason });
    return { processed: 0, failed: 0, skipped: 0, deferred: 0, folderLookup: "failed" };
  }

  const files = await drive.listImages(inbox.id);
  const textFiles = await drive.listTextFiles(inbox.id);
  const removedTextIds = new Set<string>();
  const discardText = (textFile: DriveFile) =>
    discardInboxText({
      drive,
      textFile,
      inboxFolderId: inbox.id,
      processedFolderId: processed.id,
      removedTextIds,
    });
  const craft = createCraftClient({
    baseUrl: credentials.craftApiBaseUrl,
    apiKey: credentials.craftApiKey,
  });
  let craftSpaceId = "";
  try {
    craftSpaceId = connectionSpaceId(await craft.getConnection());
  } catch (error) {
    console.error(`Craft connection lookup failed: ${sanitizeErrorMessage((error as Error).message)}`);
  }
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

  const summary = await processInbox({
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
    removeTextFiles: async (image) => {
      const stem = fileStem(image.name);
      for (const textFile of textFiles) {
        if (fileStem(textFile.name) === stem) await discardText(textFile);
      }
    },
    notifySaved: (input) => notify.saved({ ...input, spaceId: craftSpaceId }),
    notifyFailed: (input) => notify.failed(input),
    getRemainingTimeMs: () => context.getRemainingTimeInMillis(),
  });

  const remainingImages = await drive.listImages(inbox.id);
  for (const textFile of orphanTextFiles(textFiles, remainingImages)) {
    await discardText(textFile);
  }
  return summary;
}

function createLineNotifier(credentials: Credentials) {
  const line =
    credentials.lineChannelAccessToken && credentials.lineUserId
      ? createLineClient({
          channelAccessToken: credentials.lineChannelAccessToken,
          userId: credentials.lineUserId,
        })
      : null;
  return {
    async saved({ title, documentId, spaceId }: { title: string; documentId: string; spaceId: string }) {
      const appLink = spaceId && documentId ? craftAppDocumentLink(spaceId, documentId) : "";
      await pushLine(line, transcriptionSavedMessage(title, appLink));
    },
    async failed({ fileName, reason }: { fileName: string; reason: string }) {
      await pushLine(line, transcriptionFailedMessage(fileName, reason));
    },
  };
}

async function pushLine(line: LineClient | null, text: string): Promise<void> {
  if (!line) {
    console.error("LINE通知失敗: credentials are missing");
    return;
  }
  try {
    await line.push(text);
    console.log("LINE通知");
  } catch (error) {
    console.error(`LINE通知失敗: ${sanitizeErrorMessage((error as Error).message)}`);
  }
}

async function discardInboxText({
  drive,
  textFile,
  inboxFolderId,
  processedFolderId,
  removedTextIds,
}: {
  drive: DriveClient;
  textFile: DriveFile;
  inboxFolderId: string;
  processedFolderId: string;
  removedTextIds: Set<string>;
}): Promise<void> {
  if (removedTextIds.has(textFile.id)) return;
  removedTextIds.add(textFile.id);
  try {
    await drive.deleteFile(textFile.id);
    console.log(`txt削除 ${textFile.name}`);
  } catch (error) {
    const err = error as Error & { status?: number };
    if (err.status !== 403) {
      console.error(`txt削除失敗 ${textFile.name}: ${sanitizeErrorMessage(err.message)}`);
      return;
    }
    try {
      await drive.moveFile({
        fileId: textFile.id,
        addParentId: processedFolderId,
        removeParentId: inboxFolderId,
      });
      console.log(`txt移動 ${textFile.name}`);
    } catch (moveError) {
      console.error(`txt削除失敗 ${textFile.name}: ${sanitizeErrorMessage((moveError as Error).message)}`);
    }
  }
}
