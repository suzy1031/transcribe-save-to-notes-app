import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { createDriveClient } from "../drive/drive.ts";
import { csvImportFailedMessage } from "../line/helper.ts";
import { obsidianAppNoteLink } from "../obsidian/helper.ts";
import { createObsidianClient } from "../obsidian/obsidian.ts";
import { createLinePush } from "../shared/job.ts";
import { loadCredentials } from "../shared/settings.ts";
import {
  AMOUNT_PATTERN,
  CASH_AMOUNT_COLUMN_INDEX,
  CASH_CATEGORIES,
  CASH_CATEGORY_COLUMN_INDEX,
  CASH_TOTAL_LABEL_COLUMN_INDEX,
  DATE_HEADER,
  DATE_PATTERN,
  DEBIT_CATEGORY,
  DEBIT_CATEGORY_COLUMN_INDEX,
} from "./const.ts";
import {
  appendCumulativeRows,
  cumulativeMonth,
  earlierSheetTitles,
  parseMarkdownTable,
  sheetHasCumulativeMonth,
} from "./csv.ts";
import { csvImportSettingsFromEnv, importCsvFiles } from "./csv-import.ts";
import type { CsvImportResult, MonthSums } from "./types.ts";

/**
 * セル値から通貨記号・カンマ・空白を除去して数値にパースする。空文字の場合は `null` を返す。
 * 数値形式でない場合はエラーを送出する。
 * @param value セル値
 * @returns 数値、または空セル時は `null`
 */
export function parseAmount(value: unknown): number | null {
  const trimmed = String(value ?? "").trim();
  if (trimmed === "") return null;
  const normalized = trimmed.replace(/[¥￥円,\s]/g, "");
  if (!AMOUNT_PATTERN.test(normalized)) {
    throw new Error(`金額にできない値です: ${trimmed}`);
  }
  return Number(normalized);
}

/**
 * 合計数値を整数または小数点以下 2 桁までに丸めた文字列へ整形する。
 * @param sum 合計値
 * @returns 整形された合計文字列
 */
export function formatTotal(sum: number): string {
  if (Number.isInteger(sum)) return String(sum);
  return String(Math.round(sum * 100) / 100);
}

/**
 * ヘッダー名（「金額」など）または数値列の走査により、合計対象となる金額列のインデックスを特定する。
 * 該当列が見つからない場合はエラーを送出する。
 * @param rows CSV の全行データ（1 行目はヘッダー）
 * @returns 金額列の 0 始まりインデックス
 */
export function amountColumnIndex(rows: ReadonlyArray<ReadonlyArray<unknown>>): number {
  const header = rows[0].map((cell) => String(cell).trim());
  const exact: number[] = [];
  const contains: number[] = [];
  header.forEach((name, index) => {
    if (name === "金額" || name === "合計金額") exact.push(index);
    else if (name.includes("金額")) contains.push(index);
  });
  if (exact.length > 0) return exact[exact.length - 1];
  if (contains.length > 0) return contains[contains.length - 1];

  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  for (let column = width - 1; column >= 0; column -= 1) {
    let hasValue = false;
    let numeric = true;
    for (const row of rows.slice(1)) {
      const cell = String(row[column] ?? "").trim();
      if (cell === "") continue;
      hasValue = true;
      try {
        parseAmount(cell);
      } catch {
        numeric = false;
      }
    }
    if (numeric && hasValue) return column;
  }
  throw new Error("合計する数値の列がありません");
}

/**
 * ヘッダー行から「日付」列のインデックスを返す。見つからない場合は `null` を返す。
 * @param rows シートの全行データ
 * @returns 日付列のインデックス、または `null`
 */
export function dateColumnIndex(rows: ReadonlyArray<ReadonlyArray<unknown>>): number | null {
  if (rows.length === 0) return null;
  const index = rows[0].findIndex((cell) => String(cell).trim() === DATE_HEADER);
  return index === -1 ? null : index;
}

/**
 * 行データから日付セルを読み取り、`YYYY-MM-DD` 形式に正規化して返す。
 * 空文字の場合は `null` を返し、日付形式に一致しない場合はエラーを送出する。
 * @param row 1 行分のセル配列
 * @param dateIndex 日付列のインデックス
 * @returns `YYYY-MM-DD` 形式の日付文字列、または `null`
 */
export function rowDate(row: ReadonlyArray<unknown>, dateIndex: number): string | null {
  const value = String(row[dateIndex] ?? "").trim();
  if (value === "") return null;
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new Error(`日付にできない値です: ${value}`);
  return `${match[1]}-${match[3]}-${match[4]}`;
}

/**
 * 指定された月（`YYYY-MM`）に該当する行の全体・デビット・現金の合計額を算出する。
 * @param rows シートの全行データ
 * @param month 集計対象月（`YYYY-MM`）
 * @returns 全体・デビット・現金の合計額
 */
export function monthSums(rows: ReadonlyArray<ReadonlyArray<string>>, month: string): MonthSums {
  const dateIndex = dateColumnIndex(rows);
  const sums: MonthSums = { total: 0, debit: 0, cash: 0 };
  if (dateIndex === null) return sums;
  for (const row of rows.slice(1)) {
    const date = rowDate(row, dateIndex);
    if (date === null || date.slice(0, 7) !== month) continue;
    const amount = parseAmount(row[CASH_AMOUNT_COLUMN_INDEX] ?? "");
    if (amount === null) continue;
    sums.total += amount;
    if (String(row[DEBIT_CATEGORY_COLUMN_INDEX] ?? "").trim() === DEBIT_CATEGORY) sums.debit += amount;
    if (CASH_CATEGORIES.has(String(row[CASH_CATEGORY_COLUMN_INDEX] ?? "").trim())) sums.cash += amount;
  }
  return sums;
}

/**
 * 累計サマリー行（金額とラベルを所定列に配置した行配列）を生成する。
 * @param width 行の最小列幅
 * @param amount 累計金額
 * @param label ラベル文字列
 * @returns 1 行分の文字列配列
 */
export function cumulativeRow(width: number, amount: number, label: string): string[] {
  const row = Array.from({ length: Math.max(width, CASH_TOTAL_LABEL_COLUMN_INDEX + 1) }, () => "");
  row[CASH_AMOUNT_COLUMN_INDEX] = formatTotal(amount);
  row[CASH_TOTAL_LABEL_COLUMN_INDEX] = label;
  return row;
}

/**
 * 過去の同月シートを読み込んで合算し、累計行を末尾に付与した行データを返す。
 * 日付列が無い場合は入力の `weekly` をそのまま返す。
 * @param weekly 週次合計行付与済みの行データ
 * @param title 新規作成するシートタイトル
 * @param titles 既存シートタイトル一覧
 * @param readSheet シート内容を読み込む関数
 * @returns 累計行付与済みの行データ
 */
export async function rowsWithCumulative(
  weekly: string[][],
  title: string,
  titles: ReadonlyArray<string>,
  readSheet: ((title: string) => Promise<ReadonlyArray<ReadonlyArray<string>>>) | undefined,
): Promise<string[][]> {
  const month = cumulativeMonth(weekly);
  if (month === null) return weekly;
  const previous: string[][][] = [];
  for (const earlier of earlierSheetTitles(titles, title)) {
    if (!readSheet) throw new Error("前週のシートを読めません");
    const sheetRows = await readSheet(earlier);
    if (!sheetHasCumulativeMonth(sheetRows, month)) break;
    previous.push(sheetRows.map((row) => row.map((cell) => String(cell))));
  }
  return appendCumulativeRows(weekly, previous);
}

/**
 * 環境変数・認証情報を読み込み、Google Drive 上の CSV ファイルを Obsidian S3 バケットへ取り込む一連の処理を実行する。
 * @returns 取り込み件数・失敗件数・失敗詳細を含む実行結果
 */
export async function runCsvImport(): Promise<CsvImportResult> {
  const settings = csvImportSettingsFromEnv();
  const credentials = await loadCredentials(settings, new SecretsManagerClient({ region: settings.bedrockRegion }));
  const pushLine = createLinePush(credentials);
  const drive = createDriveClient({ serviceAccount: credentials.serviceAccount });
  const obsidian = createObsidianClient({
    bucketName: settings.notesBucketName,
    region: settings.bedrockRegion,
  });

  const inbox = await drive.findUniqueFolder(settings.inboxFolderName);
  const processed = await drive.findUniqueFolder(settings.processedFolderName);
  if (!inbox.ok || !processed.ok) {
    const inboxCount = inbox.ok ? 1 : inbox.count;
    const processedCount = processed.ok ? 1 : processed.count;
    const reason = `Drive folder lookup failed: csv_inbox=${inboxCount} csv_processed=${processedCount}`;
    console.error(reason);
    await pushLine(csvImportFailedMessage(reason));
    return { imported: 0, failed: 0, failures: [], folderLookup: "failed" };
  }

  const files = await drive.listCsvFiles(inbox.id);
  const existingNotes = files.length === 0 ? [] : await obsidian.listNotes({ folder: settings.householdBudgetFolder });
  const keyByTitle = new Map(existingNotes.map((note) => [note.title, note.key]));
  return importCsvFiles({
    files,
    download: (file) => drive.download(file.id),
    existingNoteTitles: existingNotes.map((note) => note.title),
    readNoteRows: async (title) => {
      const key = keyByTitle.get(title);
      if (!key) return [];
      return parseMarkdownTable(await obsidian.readMarkdown(key));
    },
    writeNote: ({ title, date, markdown }) =>
      obsidian.createNote({
        folder: settings.householdBudgetFolder,
        title,
        date,
        markdown,
        tags: ["household-budget"],
      }),
    moveToProcessed: (file) =>
      drive.moveFile({
        fileId: file.id,
        addParentId: processed.id,
        removeParentId: inbox.id,
      }),
    pushLine,
    buildNoteLink: (noteKey) => obsidianAppNoteLink(settings.obsidianVaultName, noteKey),
  });
}
