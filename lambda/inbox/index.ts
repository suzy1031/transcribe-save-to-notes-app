import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { createDriveClient } from "../drive/drive.ts";
import { fileStem, orphanTextFiles } from "../drive/helper.ts";
import type { DriveClient, DriveFile } from "../drive/types.ts";
import { transcriptionFailedMessage, transcriptionSavedMessage } from "../line/helper.ts";
import { obsidianAppNoteLink } from "../obsidian/helper.ts";
import { createObsidianClient } from "../obsidian/obsidian.ts";
import { bunLambdaHandler } from "../shared/bun-handler.ts";
import {
  DEFAULT_MCP_DOMAIN_NAME,
  INBOX_FOLDER_NAME,
  MAX_TRANSCRIPTION_TOKENS,
  MIN_REMAINING_MS,
  PROCESSED_DRIVE_FOLDER_NAME,
  TRANSCRIBE_USER_PROMPT,
} from "../shared/const.ts";
import { createLinePush, runLogged } from "../shared/job.ts";
import {
  buildMcpServerDefinitions,
  callClaudeMessages,
  imageMediaType,
  requireAnthropicApiKey,
} from "../shared/llm.ts";
import { sanitizeErrorMessage } from "../shared/sanitize-error.ts";
import { loadCredentials, settingsFromEnv } from "../shared/settings.ts";
import type { BaseSettings, Credentials, LambdaContextLike, LoggerLike } from "../shared/types.ts";
import { createTranscription, MAX_IMAGE_BYTES } from "../transcribe/index.ts";
import { SYSTEM_PROMPT } from "../transcribe/prompt.ts";
import type { ParsedTranscription, TranscribeInput } from "../transcribe/types.ts";
import type { ProcessInboxSummary } from "./types.ts";

export async function processInbox({
  files,
  download,
  transcribe,
  saveNote,
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
  saveNote: (input: { title: string; markdown: string }) => Promise<string>;
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
      stage = "obsidian保存";
      log.info(`obsidian保存 start ${file.name}`);
      const noteKey = await saveNote({
        title: note.title,
        markdown: note.markdown,
      });
      log.info(`obsidian保存 end ${file.name}`);
      stage = "移動";
      await moveToProcessed({ file, craftDocumentId: noteKey });
      await removeTextFiles(file);
      summary.processed += 1;
      await notifySaved({ title: note.title, documentId: noteKey });
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

export async function runInboxWithMcp({
  context,
  settings = settingsFromEnv(),
  credentials,
  drive: driveClient,
  rootDomain = process.env.MCP_DOMAIN_NAME || DEFAULT_MCP_DOMAIN_NAME,
  fetchImpl = fetch,
  recordUsage,
}: {
  context: LambdaContextLike;
  settings?: BaseSettings;
  credentials?: Credentials;
  drive?: DriveClient;
  rootDomain?: string;
  fetchImpl?: typeof fetch;
  recordUsage?: Parameters<typeof callClaudeMessages>[0]["recordUsage"];
}): Promise<ProcessInboxSummary> {
  const creds =
    credentials ?? (await loadCredentials(settings, new SecretsManagerClient({ region: settings.bedrockRegion })));
  const mcpAuthToken = (creds.mcpAuthToken ?? "").trim();
  if (!mcpAuthToken) {
    throw new Error("mcpAuthToken is required when USE_MCP_SERVERS=true");
  }
  const drive = driveClient ?? createDriveClient({ serviceAccount: creds.serviceAccount });
  const inbox = await drive.findUniqueFolder(INBOX_FOLDER_NAME);
  const processed = await drive.findUniqueFolder(PROCESSED_DRIVE_FOLDER_NAME);
  const summary: ProcessInboxSummary = { processed: 0, failed: 0, skipped: 0, deferred: 0 };
  if (!inbox.ok || !processed.ok) {
    const inboxCount = inbox.ok ? 1 : inbox.count;
    const processedCount = processed.ok ? 1 : processed.count;
    console.error(`画像ファイル取得失敗 inbox=${inboxCount} processed=${processedCount}`);
    return { ...summary, folderLookup: "failed" };
  }

  const files = await drive.listImages(inbox.id);
  if (files.length === 0) {
    console.info("画像ファイル取得なし");
    return summary;
  }

  const mcpServers = buildMcpServerDefinitions({
    domains: ["obsidian", "drive", "line"],
    authToken: mcpAuthToken,
    rootDomain,
  });
  const apiKey = requireAnthropicApiKey(creds.anthropicApiKey);

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (context.getRemainingTimeInMillis() < MIN_REMAINING_MS) {
      summary.deferred += files.length - index;
      console.info(`Deferred ${summary.deferred} file(s): remaining time is under 60 seconds`);
      break;
    }
    try {
      const listedSize = file.size != null && file.size !== "" ? Number(file.size) : Number.NaN;
      if (Number.isFinite(listedSize) && listedSize > MAX_IMAGE_BYTES) {
        summary.skipped += 1;
        console.error(`Skipped ${file.name}: image exceeds the size limit`);
        continue;
      }
      const bytes = await drive.download(file.id);
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        summary.skipped += 1;
        console.error(`Skipped ${file.name}: image exceeds the size limit`);
        continue;
      }
      const isLast = index === files.length - 1;
      const instruction = [
        TRANSCRIBE_USER_PROMPT,
        `対象ファイル: name="${file.name}", fileId="${file.id}", inboxFolderId="${inbox.id}", processedFolderId="${processed.id}".`,
        `1. 画像を文字起こしし、obsidian_save_or_append_note（folder="${settings.obsidianDailyFolder}", tags=["daily"]）で保存して key と appLink を取得してください。`,
        `2. drive_mark_as_processed（fileId="${file.id}", inboxFolderId="${inbox.id}", processedFolderId="${processed.id}", noteKey=<取得したkey>）で処理済みへ移動してください。`,
        `3. line_send_notification でタイトルと appLink を改行区切りで LINE 通知してください。`,
        ...(isLast
          ? [
              `4. 最後に drive_cleanup_companion_texts（inboxFolderId="${inbox.id}", processedFolderId="${processed.id}"）を実行してください。`,
            ]
          : []),
      ].join("\n");

      await callClaudeMessages({
        apiKey,
        modelId: settings.claudeModelId,
        maxTokens: MAX_TRANSCRIPTION_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: imageMediaType(file.mimeType),
                  data: Buffer.from(bytes).toString("base64"),
                },
              },
              { type: "text", text: instruction },
            ],
          },
        ],
        mcpServers,
        functionName: "index",
        errorPrefix: "Claude MCP inbox transcription failed",
        fetchImpl,
        ...(recordUsage ? { recordUsage } : {}),
      });
      summary.processed += 1;
    } catch (error) {
      summary.failed += 1;
      console.error(`MCP文字起こし失敗 ${file.name}: ${sanitizeErrorMessage((error as Error).message)}`);
    }
  }
  return summary;
}

export async function handler(event: unknown, context: LambdaContextLike): Promise<ProcessInboxSummary> {
  return runLogged(() =>
    process.env.USE_MCP_SERVERS === "true" ? runInboxWithMcp({ context }) : runPipeline(context),
  );
}

async function runPipeline(context: LambdaContextLike): Promise<ProcessInboxSummary> {
  const settings = settingsFromEnv();
  const credentials = await loadCredentials(settings, new SecretsManagerClient({ region: settings.bedrockRegion }));
  const drive = createDriveClient({ serviceAccount: credentials.serviceAccount });
  const inbox = await drive.findUniqueFolder(INBOX_FOLDER_NAME);
  const processed = await drive.findUniqueFolder(PROCESSED_DRIVE_FOLDER_NAME);
  const notify = createLineNotifier(createLinePush(credentials));
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
  const obsidian = createObsidianClient({
    bucketName: settings.notesBucketName,
    region: settings.bedrockRegion,
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

  const summary = await processInbox({
    files,
    download: (file) => drive.download(file.id),
    transcribe: transcription.transcribe,
    maxImageBytes: transcription.maxImageBytes,
    saveNote: ({ title, markdown }) =>
      obsidian.saveOrAppendNote({
        folder: settings.obsidianDailyFolder,
        title,
        markdown,
        tags: ["daily"],
      }),
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
    notifySaved: (input) => notify.saved({ ...input, vaultName: settings.obsidianVaultName }),
    notifyFailed: (input) => notify.failed(input),
    getRemainingTimeMs: () => context.getRemainingTimeInMillis(),
  });

  const remainingImages = await drive.listImages(inbox.id);
  for (const textFile of orphanTextFiles(textFiles, remainingImages)) {
    await discardText(textFile);
  }
  return summary;
}

function createLineNotifier(pushLine: (text: string) => Promise<void>) {
  return {
    async saved({ title, documentId, vaultName }: { title: string; documentId: string; vaultName: string }) {
      const appLink = vaultName && documentId ? obsidianAppNoteLink(vaultName, documentId) : "";
      await pushLine(transcriptionSavedMessage(title, appLink));
    },
    async failed({ fileName, reason }: { fileName: string; reason: string }) {
      await pushLine(transcriptionFailedMessage(fileName, reason));
    },
  };
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

export default bunLambdaHandler(handler);
