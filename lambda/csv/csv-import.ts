import { csvImportSummaryMessage, EMPTY_CSV_MESSAGE } from "../line/helper.ts";
import { bunLambdaHandler } from "../shared/bun-handler.ts";
import { DEFAULT_CSV_INBOX_FOLDER, DEFAULT_CSV_PROCESSED_FOLDER, DEFAULT_CSV_SPREADSHEET_ID } from "../shared/const.ts";
import { runLogged } from "../shared/job.ts";
import { settingsFromEnv } from "../shared/settings.ts";
import { tokyoDate } from "../shared/tokyo-date.ts";
import { appendCashTotalRow, appendDebitTotalRow, appendTotalRow, parseCsv, sheetTitle } from "./csv.ts";
import { rowsWithCumulative, runCsvImport } from "./helper.ts";
import type { CsvImportResult, CsvImportSettings, ImportCsvFilesOptions } from "./types.ts";

/**
 * 環境変数から CSV 取り込み用の設定（受信フォルダ名・処理済みフォルダ名・スプレッドシート ID 等）を構築する。
 * @param env 環境変数オブジェクト（デフォルトは `process.env`）
 * @returns CSV 取り込み設定
 */
export function csvImportSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): CsvImportSettings {
  return {
    ...settingsFromEnv(env),
    inboxFolderName: env.CSV_INBOX_FOLDER_NAME || DEFAULT_CSV_INBOX_FOLDER,
    processedFolderName: env.CSV_PROCESSED_FOLDER_NAME || DEFAULT_CSV_PROCESSED_FOLDER,
    spreadsheetId: env.CSV_SPREADSHEET_ID || DEFAULT_CSV_SPREADSHEET_ID,
  };
}

/**
 * 指定された CSV ファイル群をダウンロード・集計してスプレッドシートへ書き込み、処理済みフォルダへ移動して LINE 通知する。
 * @param options ファイル一覧・I/O コールバック・通知関数・基準日時などのオプション
 * @returns 取り込み件数・失敗件数・失敗詳細を含む実行結果
 */
export async function importCsvFiles({
  files,
  download,
  existingSheetTitles,
  readSheet,
  writeSheet,
  moveToProcessed,
  pushLine,
  spreadsheetUrl: sheetUrl,
  now = new Date(),
}: ImportCsvFilesOptions): Promise<CsvImportResult> {
  if (files.length === 0) {
    await pushLine(EMPTY_CSV_MESSAGE);
    return { imported: 0, failed: 0, failures: [] };
  }

  const titles = new Set(existingSheetTitles.map((title) => title.toLowerCase()));
  const knownTitles = [...existingSheetTitles];
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
      const parsed = parseCsv(text);
      const weekly = appendCashTotalRow(appendDebitTotalRow(appendTotalRow(parsed)));
      const rows = await rowsWithCumulative(weekly, title, knownTitles, readSheet);
      await writeSheet({ title, rows });
      titles.add(title.toLowerCase());
      knownTitles.push(title);
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

/**
 * CSV 取り込み Lambda のエントリポイントハンドラー。
 * @param event Lambda イベント
 * @param context Lambda コンテキスト
 * @returns 取り込み結果
 */
export async function handler(event: unknown, context: unknown): Promise<CsvImportResult> {
  return runLogged(() => runCsvImport());
}

export default bunLambdaHandler(handler);
