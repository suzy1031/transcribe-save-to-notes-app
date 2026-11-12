import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import {
  DEFAULT_CSV_INBOX_FOLDER,
  DEFAULT_CSV_PROCESSED_FOLDER,
  DEFAULT_CSV_SPREADSHEET_ID,
} from "./const.ts";
import { parseCsv, sheetTitle, spreadsheetAppLink, tokyoDate, appendTotalRow } from "./csv.ts";
import { createDriveClient, type DriveFile } from "./drive.ts";
import { loadCredentials, settingsFromEnv, type BaseSettings } from "./index.ts";
import {
  createLineClient,
  csvImportFailedMessage,
  csvImportSummaryMessage,
  EMPTY_CSV_MESSAGE,
  type CsvImportFailure,
  type LineClient,
} from "./line.ts";
import { sanitizeErrorMessage } from "./sanitize-error.ts";
import { createSheetsClient } from "./sheets.ts";

export interface CsvImportSettings extends BaseSettings {
  inboxFolderName: string;
  processedFolderName: string;
  spreadsheetId: string;
}

export interface CsvImportResult {
  imported: number;
  failed: number;
  failures: CsvImportFailure[];
  folderLookup?: string;
}

export function csvImportSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): CsvImportSettings {
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
}: {
  files: ReadonlyArray<DriveFile>;
  download: (file: DriveFile) => Promise<Uint8Array | Buffer>;
  existingSheetTitles: ReadonlyArray<string>;
  writeSheet: (input: { title: string; rows: string[][] }) => Promise<void>;
  moveToProcessed: (file: DriveFile) => Promise<void>;
  pushLine: (text: string) => Promise<void>;
  spreadsheetUrl?: string;
  now?: Date;
}): Promise<CsvImportResult> {
  if (files.length === 0) {
    await pushLine(EMPTY_CSV_MESSAGE);
    return { imported: 0, failed: 0, failures: [] };
  }

  const titles = new Set(existingSheetTitles.map((title) => title.toLowerCase()));
  const date = tokyoDate(now);
  const result: CsvImportResult = { imported: 0, failed: 0, failures: [] };

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
      const rows = appendTotalRow(parseCsv(text));
      await writeSheet({ title, rows });
      titles.add(title.toLowerCase());
    } catch (error) {
      result.failed += 1;
      result.failures.push({ fileName: file.name, reason: (error as Error).message });
      continue;
    }

    try {
      await moveToProcessed(file);
      result.imported += 1;
    } catch (error) {
      result.failed += 1;
      result.failures.push({
        fileName: file.name,
        reason: `シートは作成済みです。移動に失敗しました: ${(error as Error).message}`,
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

export async function handler(event: unknown, context: unknown): Promise<CsvImportResult> {
  console.log("start");
  try {
    return await runCsvImport();
  } finally {
    console.log("end");
  }
}

async function runCsvImport(): Promise<CsvImportResult> {
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
    const inboxCount = inbox.ok ? 1 : inbox.count;
    const processedCount = processed.ok ? 1 : processed.count;
    const reason = `Drive folder lookup failed: csv_inbox=${inboxCount} csv_processed=${processedCount}`;
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
