import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import {
  DEFAULT_CSV_INBOX_FOLDER,
  DEFAULT_CSV_PROCESSED_FOLDER,
  DEFAULT_CSV_SPREADSHEET_ID,
} from "./const.js";
import { parseCsv, sheetTitle, spreadsheetAppLink, tokyoDate } from "./csv.js";
import { createDriveClient } from "./drive.js";
import { loadCredentials, settingsFromEnv } from "./index.js";
import {
  createLineClient,
  csvImportFailedMessage,
  csvImportSummaryMessage,
  EMPTY_CSV_MESSAGE,
} from "./line.js";
import { sanitizeErrorMessage } from "./sanitize-error.js";
import { createSheetsClient } from "./sheets.js";

export function csvImportSettingsFromEnv(env = process.env) {
  return {
    ...settingsFromEnv(env),
    inboxFolderName: env.CSV_INBOX_FOLDER_NAME || DEFAULT_CSV_INBOX_FOLDER,
    processedFolderName: env.CSV_PROCESSED_FOLDER_NAME || DEFAULT_CSV_PROCESSED_FOLDER,
    spreadsheetId: env.CSV_SPREADSHEET_ID || DEFAULT_CSV_SPREADSHEET_ID,
  };
}

export async function importCsvFiles({
  files,
  download,
  existingSheetTitles,
  writeSheet,
  moveToProcessed,
  pushLine,
  spreadsheetUrl: sheetUrl,
  now = new Date(),
}) {
  if (files.length === 0) {
    await pushLine(EMPTY_CSV_MESSAGE);
    return { imported: 0, failed: 0, failures: [] };
  }

  const titles = new Set(existingSheetTitles.map((title) => title.toLowerCase()));
  const date = tokyoDate(now);
  const result = { imported: 0, failed: 0, failures: [] };

  for (const file of files) {
    const title = sheetTitle({ date, fileName: file.name });
    if (titles.has(title.toLowerCase())) {
      result.failed += 1;
      result.failures.push({
        fileName: file.name,
        reason: `シート「${title}」は既にあります`,
      });
      continue;
    }

    try {
      const bytes = await download(file);
      const text = Buffer.from(bytes).toString("utf8");
      const rows = parseCsv(text);
      if (rows.length === 0) throw new Error("CSVが空です");
      await writeSheet({ title, rows });
      titles.add(title.toLowerCase());
    } catch (error) {
      result.failed += 1;
      result.failures.push({ fileName: file.name, reason: error.message });
      continue;
    }

    try {
      await moveToProcessed(file);
      result.imported += 1;
    } catch (error) {
      result.failed += 1;
      result.failures.push({
        fileName: file.name,
        reason: `シートは作成済みです。移動に失敗しました: ${error.message}`,
      });
    }
  }

  await pushLine(
    csvImportSummaryMessage({
      imported: result.imported,
      failed: result.failed,
      spreadsheetUrl: sheetUrl,
      failures: result.failures,
    }),
  );
  return result;
}

export async function handler(event, context) {
  console.log("start");
  try {
    return await runCsvImport();
  } finally {
    console.log("end");
  }
}

async function runCsvImport() {
  const settings = csvImportSettingsFromEnv();
  const credentials = await loadCredentials(
    settings,
    new SecretsManagerClient({ region: settings.bedrockRegion }),
  );
  const line =
    credentials.lineChannelAccessToken && credentials.lineUserId
      ? createLineClient({
          channelAccessToken: credentials.lineChannelAccessToken,
          userId: credentials.lineUserId,
        })
      : null;
  const drive = createDriveClient({ serviceAccount: credentials.serviceAccount });
  const sheets = createSheetsClient({ serviceAccount: credentials.serviceAccount });

  if (!settings.spreadsheetId) {
    const reason = "CSV_SPREADSHEET_ID is required";
    console.error(reason);
    await pushLine(line, csvImportFailedMessage(reason));
    throw new Error(reason);
  }

  const inbox = await drive.findUniqueFolder(settings.inboxFolderName);
  const processed = await drive.findUniqueFolder(settings.processedFolderName);
  if (!inbox.ok || !processed.ok) {
    const reason = `Drive folder lookup failed: csv_inbox=${inbox.count} csv_processed=${processed.count}`;
    console.error(reason);
    await pushLine(line, csvImportFailedMessage(reason));
    return { imported: 0, failed: 0, failures: [], folderLookup: "failed" };
  }

  const files = await drive.listCsvFiles(inbox.id);
  const existingSheetTitles =
    files.length === 0 ? [] : await sheets.listSheetTitles(settings.spreadsheetId);
  return importCsvFiles({
    files,
    download: (file) => drive.download(file.id),
    existingSheetTitles,
    writeSheet: ({ title, rows }) =>
      sheets.addSheetWithValues({
        spreadsheetId: settings.spreadsheetId,
        title,
        rows,
      }),
    moveToProcessed: (file) =>
      drive.moveFile({
        fileId: file.id,
        addParentId: processed.id,
        removeParentId: inbox.id,
      }),
    pushLine: (text) => pushLine(line, text),
    spreadsheetUrl: spreadsheetAppLink(settings.spreadsheetId),
  });
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
    console.error(`LINE通知失敗: ${sanitizeErrorMessage(error.message)}`);
  }
}
