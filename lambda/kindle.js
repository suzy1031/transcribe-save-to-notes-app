import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { connectionSpaceId, craftAppDocumentLink, createCraftClient } from "./craft.js";
import { createDriveClient } from "./drive.js";
import { loadCredentials, settingsFromEnv } from "./index.js";
import { createKindleSummarizer } from "./kindle-summarize.js";
import { createLineClient, kindleFailedMessage, kindleRunSummaryMessage } from "./line.js";

export const ALL_CRAFT_DOCUMENTS_SINCE = "1970-01-01";
export const MIN_REMAINING_MS = 60_000;

export function kindleSettingsFromEnv(env = process.env) {
  return {
    ...settingsFromEnv(env),
    driveParentFolderName: env.KINDLE_DRIVE_PARENT_FOLDER_NAME || "kindle",
    bookFolderPrefix: env.KINDLE_BOOK_FOLDER_PREFIX || "kindle_",
    processedFolderName: env.KINDLE_PROCESSED_FOLDER_NAME || "processed",
    summaryDocTitle: env.KINDLE_SUMMARY_DOC_TITLE || "要約",
    kindleClaudeModelId: env.KINDLE_CLAUDE_MODEL_ID || env.CLAUDE_MODEL_ID || "claude-sonnet-5-5",
  };
}

export function summaryDocumentState(documents) {
  if (documents.length === 0) return { action: "create" };
  if (documents.length === 1) {
    return { action: "append", documentId: documents[0].id };
  }
  return {
    action: "error",
    reason: `Craft folder had ${documents.length} documents; expected 0 or 1`,
  };
}

export async function processKindleBooks({
  bookFolders,
  listImages,
  download,
  findCraftFolderId,
  listCraftDocuments,
  createSummaryDocument,
  appendSummary,
  summarizeImage,
  ensureProcessedFolder,
  moveImageToProcessed,
  getRemainingTimeMs = () => Number.POSITIVE_INFINITY,
  log = console,
}) {
  const result = {
    foldersScanned: bookFolders.length,
    imagesSummarized: 0,
    imagesFailed: 0,
    foldersSkippedNoCraft: 0,
    deferred: 0,
    errors: [],
    links: [],
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

    const craftFolderId = await findCraftFolderId(bookFolder.name);
    if (!craftFolderId) {
      result.foldersSkippedNoCraft += 1;
      log.info(`Craft folder not found for ${bookFolder.name}; skipping ${images.length} image(s)`);
      continue;
    }

    const documents = await listCraftDocuments(craftFolderId);
    const docState = summaryDocumentState(documents);
    if (docState.action === "error") {
      result.errors.push(`${bookFolder.name}: ${docState.reason}`);
      log.error(`${bookFolder.name}: ${docState.reason}`);
      continue;
    }

    let documentId = docState.action === "append" ? docState.documentId : null;
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
        if (documentId === null) {
          documentId = await createSummaryDocument({
            folderId: craftFolderId,
            markdown,
          });
        } else {
          await appendSummary({ documentId, markdown });
        }
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
        result.errors.push(`${bookFolder.name}/${file.name}: ${error.message}`);
        log.error(`Kindle要約失敗 ${bookFolder.name}/${file.name}: ${error.message}`);
      }
    }

    if (folderSaved && documentId) {
      result.links.push({ folderName: bookFolder.name, documentId });
    }
  }

  return result;
}

export async function handler(event, context) {
  console.log("start");
  try {
    return await runKindle(context);
  } finally {
    console.log("end");
  }
}

async function runKindle(context) {
  const settings = kindleSettingsFromEnv();
  const credentials = await loadCredentials(
    settings,
    new SecretsManagerClient({ region: settings.bedrockRegion }),
  );
  const drive = createDriveClient({ serviceAccount: credentials.serviceAccount });
  const craft = createCraftClient({
    baseUrl: credentials.craftApiBaseUrl,
    apiKey: credentials.craftApiKey,
  });
  const line =
    credentials.lineChannelAccessToken && credentials.lineUserId
      ? createLineClient({
          channelAccessToken: credentials.lineChannelAccessToken,
          userId: credentials.lineUserId,
        })
      : null;

  let craftSpaceId = "";
  try {
    craftSpaceId = connectionSpaceId(await craft.getConnection());
  } catch (error) {
    console.error(`Craft connection lookup failed: ${error.message}`);
  }

  const parent = await drive.findUniqueFolder(settings.driveParentFolderName);
  if (!parent.ok) {
    const reason = `Drive folder lookup failed: kindle=${parent.count}`;
    console.error(reason);
    await pushLine(line, kindleFailedMessage(reason));
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
    findCraftFolderId: (name) => craft.findFolder(name),
    listCraftDocuments: (folderId) =>
      craft.listDocuments({ folderId, createdDateGte: ALL_CRAFT_DOCUMENTS_SINCE }),
    createSummaryDocument: ({ folderId, markdown }) =>
      craft.createDocument({
        title: settings.summaryDocTitle,
        markdown,
        folderId,
      }),
    appendSummary: ({ documentId, markdown }) =>
      craft.appendMarkdown({ pageId: documentId, markdown }),
    summarizeImage,
    ensureProcessedFolder: (bookFolderId) =>
      drive.ensureChildFolder(bookFolderId, settings.processedFolderName),
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
        craftSpaceId && documentId ? craftAppDocumentLink(craftSpaceId, documentId) : "",
    }));
    await pushLine(
      line,
      kindleRunSummaryMessage({
        summarized: summary.imagesSummarized,
        failed: summary.imagesFailed,
        links,
      }),
    );
  }

  console.log(
    `Kindle要約 ${summary.imagesSummarized}枚 失敗 ${summary.imagesFailed}枚 Craft未設定 ${summary.foldersSkippedNoCraft}件`,
  );
  return summary;
}

async function pushLine(line, text) {
  if (!line) {
    console.error("LINE通知失敗: credentials are missing");
    return;
  }
  try {
    await line.push(text);
    console.log("LINE通知");
  } catch (error) {
    console.error(`LINE通知失敗: ${error.message}`);
  }
}
