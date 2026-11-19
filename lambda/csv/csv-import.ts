import { csvImportSummaryMessage, EMPTY_CSV_MESSAGE } from "../line/helper.ts";
import { bunLambdaHandler } from "../shared/bun-handler.ts";
import {
  DEFAULT_CSV_INBOX_FOLDER,
  DEFAULT_CSV_PROCESSED_FOLDER,
  DEFAULT_OBSIDIAN_HOUSEHOLD_BUDGET_FOLDER,
} from "../shared/const.ts";
import { runLogged } from "../shared/job.ts";
import { settingsFromEnv } from "../shared/settings.ts";
import { tokyoDate } from "../shared/tokyo-date.ts";
import {
  appendCashTotalRow,
  appendDebitTotalRow,
  appendTotalRow,
  parseCsv,
  rowsToMarkdownTable,
  sheetTitle,
} from "./csv.ts";
import { rowsWithCumulative, runCsvImport } from "./helper.ts";
import type { CsvImportResult, CsvImportSettings, ImportCsvFilesOptions } from "./types.ts";

/**
 * 環境変数から CSV 取り込み用の設定（受信フォルダ名・処理済みフォルダ名・保存先フォルダ等）を構築する。
 * @param env 環境変数オブジェクト（デフォルトは `process.env`）
 * @returns CSV 取り込み設定
 */
export function csvImportSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): CsvImportSettings {
  return {
    ...settingsFromEnv(env),
    inboxFolderName: env.CSV_INBOX_FOLDER_NAME || DEFAULT_CSV_INBOX_FOLDER,
    processedFolderName: env.CSV_PROCESSED_FOLDER_NAME || DEFAULT_CSV_PROCESSED_FOLDER,
    householdBudgetFolder: env.OBSIDIAN_HOUSEHOLD_BUDGET_FOLDER || DEFAULT_OBSIDIAN_HOUSEHOLD_BUDGET_FOLDER,
  };
}

/**
 * 指定された CSV ファイル群をダウンロード・集計して Markdown テーブルとして S3 へ保存し、処理済みフォルダへ移動して LINE 通知する。
 * @param options ファイル一覧・I/O コールバック・通知関数・基準日時などのオプション
 * @returns 取り込み件数・失敗件数・失敗詳細を含む実行結果
 */
export async function importCsvFiles({
  files,
  download,
  existingNoteTitles,
  readNoteRows,
  writeNote,
  moveToProcessed,
  pushLine,
  buildNoteLink,
  now = new Date(),
}: ImportCsvFilesOptions): Promise<CsvImportResult> {
  if (files.length === 0) {
    await pushLine(EMPTY_CSV_MESSAGE);
    return { imported: 0, failed: 0, failures: [] };
  }

  const titles = new Set(existingNoteTitles.map((title) => title.toLowerCase()));
  const knownTitles = [...existingNoteTitles];
  const date = tokyoDate(now);
  const result: CsvImportResult = { imported: 0, failed: 0, failures: [] };
  const noteLinks: string[] = [];

  for (const file of files) {
    const title = sheetTitle({ date, fileName: file.name });
    if (titles.has(title.toLowerCase())) {
      result.failed += 1;
      result.failures.push({
        fileName: file.name,
        reason: `ノート「${title}」は既にあります`,
      });
      continue;
    }

    let noteKey = "";
    try {
      const bytes = await download(file);
      const text = Buffer.from(bytes).toString("utf8");
      const parsed = parseCsv(text);
      const weekly = appendCashTotalRow(appendDebitTotalRow(appendTotalRow(parsed)));
      const rows = await rowsWithCumulative(weekly, title, knownTitles, readNoteRows);
      const markdown = rowsToMarkdownTable(rows);
      noteKey = await writeNote({ title, date, markdown });
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
      const link = buildNoteLink?.(noteKey);
      if (link) noteLinks.push(link);
    } catch (error) {
      result.failed += 1;
      result.failures.push({
        fileName: file.name,
        reason: `ノートは作成済みです。移動に失敗しました: ${(error as Error).message}`,
      });
    }
  }

  await pushLine(
    csvImportSummaryMessage({
      imported: result.imported,
      failed: result.failed,
      noteLinks,
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
