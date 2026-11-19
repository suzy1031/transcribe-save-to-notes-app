import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { createDriveClient } from "../drive/drive.ts";
import type { DriveFile } from "../drive/types.ts";
import { kindleFailedMessage, kindleRunSummaryMessage } from "../line/helper.ts";
import { obsidianAppNoteLink } from "../obsidian/helper.ts";
import { createObsidianClient } from "../obsidian/obsidian.ts";
import { bunLambdaHandler } from "../shared/bun-handler.ts";
import {
  DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID,
  DEFAULT_KINDLE_BOOK_PREFIX,
  DEFAULT_KINDLE_DRIVE_PARENT,
  DEFAULT_KINDLE_PROCESSED_FOLDER,
  DEFAULT_OBSIDIAN_KINDLE_FOLDER,
  MIN_REMAINING_MS,
} from "../shared/const.ts";
import { createLinePush, runLogged } from "../shared/job.ts";
import { sanitizeErrorMessage } from "../shared/sanitize-error.ts";
import { loadCredentials, settingsFromEnv } from "../shared/settings.ts";
import type { LambdaContextLike, LoggerLike } from "../shared/types.ts";
import type { TranscribeInput } from "../transcribe/types.ts";
import { createKindleSummarizer } from "./kindle-summarize.ts";
import type { KindleSettings, ProcessKindleResult } from "./types.ts";

export function kindleSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): KindleSettings {
  return {
    ...settingsFromEnv(env),
    driveParentFolderName: env.KINDLE_DRIVE_PARENT_FOLDER_NAME || DEFAULT_KINDLE_DRIVE_PARENT,
    bookFolderPrefix: env.KINDLE_BOOK_FOLDER_PREFIX || DEFAULT_KINDLE_BOOK_PREFIX,
    processedFolderName: env.KINDLE_PROCESSED_FOLDER_NAME || DEFAULT_KINDLE_PROCESSED_FOLDER,
    obsidianKindleFolder: env.OBSIDIAN_KINDLE_FOLDER || DEFAULT_OBSIDIAN_KINDLE_FOLDER,
    kindleClaudeModelId: env.KINDLE_CLAUDE_MODEL_ID || env.CLAUDE_MODEL_ID || DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID,
  };
}

export async function processKindleBooks({
  bookFolders,
  listImages,
  download,
  saveOrAppendBookNote,
  summarizeImage,
  ensureProcessedFolder,
  moveImageToProcessed,
  getRemainingTimeMs = () => Number.POSITIVE_INFINITY,
  log = console,
}: {
  bookFolders: ReadonlyArray<DriveFile>;
  listImages: (folderId: string) => Promise<DriveFile[]>;
  download: (file: DriveFile) => Promise<Uint8Array | Buffer>;
  saveOrAppendBookNote: (input: { bookTitle: string; markdown: string }) => Promise<string>;
  summarizeImage: (input: TranscribeInput) => Promise<string>;
  ensureProcessedFolder: (bookFolderId: string) => Promise<string>;
  moveImageToProcessed: (input: { file: DriveFile; bookFolderId: string; processedFolderId: string }) => Promise<void>;
  getRemainingTimeMs?: () => number;
  log?: LoggerLike;
}): Promise<Required<Omit<ProcessKindleResult, "folderLookup">>> {
  const result = {
    foldersScanned: bookFolders.length,
    imagesSummarized: 0,
    imagesFailed: 0,
    deferred: 0,
    errors: [] as string[],
    links: [] as Array<{ folderName: string; documentId: string }>,
  };

  for (let folderIndex = 0; folderIndex < bookFolders.length; folderIndex += 1) {
    const bookFolder = bookFolders[folderIndex];
    if (getRemainingTimeMs() < MIN_REMAINING_MS) {
      result.deferred += bookFolders.length - folderIndex;
      log.info(`Deferred ${result.deferred} book folder(s): remaining time is under 60 seconds`);
      break;
    }

    const images = await listImages(bookFolder.id);
    if (images.length === 0) continue;

    let documentId: string | null = null;
    let folderSaved = false;
    const processedFolderId = await ensureProcessedFolder(bookFolder.id);

    for (let index = 0; index < images.length; index += 1) {
      const file = images[index];
      if (getRemainingTimeMs() < MIN_REMAINING_MS) {
        result.deferred += images.length - index;
        log.info(`Deferred ${result.deferred} image(s): remaining time is under 60 seconds`);
        break;
      }

      try {
        log.info(`Kindle要約 start ${bookFolder.name}/${file.name}`);
        const bytes = await download(file);
        const markdown = await summarizeImage({ bytes, mimeType: file.mimeType });
        documentId = await saveOrAppendBookNote({
          bookTitle: bookFolder.name,
          markdown,
        });
        await moveImageToProcessed({
          file,
          bookFolderId: bookFolder.id,
          processedFolderId,
        });
        result.imagesSummarized += 1;
        folderSaved = true;
        log.info(`Kindle要約 end ${bookFolder.name}/${file.name}`);
      } catch (error) {
        result.imagesFailed += 1;
        const message = sanitizeErrorMessage((error as Error).message);
        result.errors.push(`${bookFolder.name}/${file.name}: ${message}`);
        log.error(`Kindle要約失敗 ${bookFolder.name}/${file.name}: ${message}`);
      }
    }

    if (folderSaved && documentId) {
      result.links.push({ folderName: bookFolder.name, documentId });
    }
  }

  return result;
}

export async function handler(event: unknown, context: LambdaContextLike): Promise<ProcessKindleResult> {
  return runLogged(() => runKindle(context));
}

async function runKindle(context: LambdaContextLike): Promise<ProcessKindleResult> {
  const settings = kindleSettingsFromEnv();
  const credentials = await loadCredentials(settings, new SecretsManagerClient({ region: settings.bedrockRegion }));
  const drive = createDriveClient({ serviceAccount: credentials.serviceAccount });
  const obsidian = createObsidianClient({
    bucketName: settings.notesBucketName,
    region: settings.bedrockRegion,
  });
  const pushLine = createLinePush(credentials);

  const parent = await drive.findUniqueFolder(settings.driveParentFolderName);
  if (!parent.ok) {
    const reason = `Drive folder lookup failed: kindle=${parent.count}`;
    console.error(reason);
    await pushLine(kindleFailedMessage(reason));
    return { foldersScanned: 0, imagesSummarized: 0, imagesFailed: 0, folderLookup: "failed" };
  }

  const bookFolders = await drive.listKindleBookFolders(parent.id, settings.bookFolderPrefix);
  const summarizeImage = createKindleSummarizer({
    provider: settings.transcriptionProvider,
    claude: {
      apiKey: credentials.anthropicApiKey,
      modelId: settings.kindleClaudeModelId,
    },
    bedrock: {
      region: settings.bedrockRegion,
      modelId: settings.bedrockModelId,
    },
  });

  const summary = await processKindleBooks({
    bookFolders,
    listImages: (folderId) => drive.listImages(folderId),
    download: (file) => drive.download(file.id),
    saveOrAppendBookNote: ({ bookTitle, markdown }) =>
      obsidian.saveOrAppendNote({
        folder: settings.obsidianKindleFolder,
        title: bookTitle,
        markdown,
        tags: ["kindle"],
      }),
    summarizeImage,
    ensureProcessedFolder: (bookFolderId) => drive.ensureChildFolder(bookFolderId, settings.processedFolderName),
    moveImageToProcessed: ({ file, bookFolderId, processedFolderId }) =>
      drive.moveFile({
        fileId: file.id,
        addParentId: processedFolderId,
        removeParentId: bookFolderId,
      }),
    getRemainingTimeMs: () => context.getRemainingTimeInMillis(),
  });

  if (summary.imagesSummarized > 0 || summary.imagesFailed > 0) {
    const links = summary.links.map(({ folderName, documentId }) => ({
      folderName,
      appLink:
        settings.obsidianVaultName && documentId ? obsidianAppNoteLink(settings.obsidianVaultName, documentId) : "",
    }));
    await pushLine(
      kindleRunSummaryMessage({
        summarized: summary.imagesSummarized,
        failed: summary.imagesFailed,
        links,
      }),
    );
  }

  console.log(`Kindle要約 ${summary.imagesSummarized}枚 失敗 ${summary.imagesFailed}枚`);
  return summary;
}

export default bunLambdaHandler(handler);
