import path from "node:path";
import type { FileLike } from "../../interfaces/csv.ts";
import {
  CASH_AMOUNT_COLUMN_INDEX,
  CASH_CATEGORIES,
  CASH_CATEGORY_COLUMN_INDEX,
  CASH_TOTAL_LABEL,
  CASH_TOTAL_LABEL_COLUMN_INDEX,
  CUMULATIVE_CASH_LABEL,
  CUMULATIVE_DEBIT_LABEL,
  CUMULATIVE_TOTAL_LABEL,
  DEBIT_AMOUNT_COLUMN_INDEX,
  DEBIT_CATEGORY,
  DEBIT_CATEGORY_COLUMN_INDEX,
  DEBIT_TOTAL_LABEL,
  INVALID_SHEET_CHARS,
  SHEET_TITLE_MAX,
  SHEET_TITLE_PATTERN,
} from "./const.ts";
import {
  amountColumnIndex,
  cumulativeRow,
  dateColumnIndex,
  formatTotal,
  monthSums,
  parseAmount,
  rowDate,
} from "./helper.ts";

/**
 * Google Drive のファイル情報が CSV ファイルであるかを MIME タイプと拡張子から判定する。
 * Google Workspace 固有ファイル（スプレッドシート等）は除外する。
 * @param file 判定対象のファイル情報
 * @returns CSV ファイルであれば `true`
 */
export function isCsvFile(file: FileLike): boolean {
  const mime = file.mimeType ?? "";
  if (mime.startsWith("application/vnd.google-apps.")) return false;
  const extension = path.extname(file.name ?? "").toLowerCase();
  return mime === "text/csv" || extension === ".csv";
}

/**
 * RFC 4180 準拠（BOM・CRLF・引用符内改行・`""` エスケープ対応）で CSV 文字列を 2 次元配列にパースする。
 * 引用符が閉じていない場合はエラーを送出する。
 * @param text CSV テキスト
 * @returns パースされた行とセルの 2 次元配列
 */
export function parseCsv(text: unknown): string[][] {
  const source = String(text).replace(/^\uFEFF/, "");
  if (source === "") return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    const isQuotedLiteralChar = inQuotes && char !== '"';
    if (isQuotedLiteralChar) {
      field += char;
      continue;
    }

    const isEscapedQuote = inQuotes && source[index + 1] === '"';
    if (isEscapedQuote) {
      field += '"';
      index += 1;
      continue;
    }

    const isClosingQuote = inQuotes;
    if (isClosingQuote) {
      inQuotes = false;
      continue;
    }

    const isOpeningQuote = char === '"' && field === "";
    if (isOpeningQuote) {
      inQuotes = true;
      continue;
    }

    const isFieldDelimiter = char === ",";
    if (isFieldDelimiter) {
      row.push(field);
      field = "";
      continue;
    }

    const isLineBreak = char === "\n" || char === "\r";
    if (isLineBreak) {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      const isCrLf = char === "\r" && source[index + 1] === "\n";
      if (isCrLf) index += 1;
      continue;
    }

    field += char;
  }

  if (inQuotes) throw new Error("CSVの引用符が閉じていません");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * 日付とファイル名から Google Sheets の制限に収まるシートタイトル（`YYYY-MM-DD_<stem>`）を生成する。
 * @param params 日付文字列と元ファイル名
 * @returns 生成されたシートタイトル
 */
export function sheetTitle({ date, fileName }: { date: string; fileName?: string }): string {
  const stem = path.basename(fileName ?? "", path.extname(fileName ?? ""));
  const cleaned = stem
    .replace(INVALID_SHEET_CHARS, "")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: sheet titles cannot contain control characters
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/^\.+/, "")
    .trim();
  return `${date}_${cleaned || "csv"}`.slice(0, SHEET_TITLE_MAX);
}

function escapeMarkdownCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i += 1;
    } else if (trimmed[i] === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += trimmed[i];
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * 2 次元配列の行データを GFM / Obsidian Markdown テーブル文字列へ変換する。
 * @param rows 1 行目をヘッダーとする 2 次元配列
 * @returns Markdown テーブル文字列
 */
export function rowsToMarkdownTable(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  if (rows.length === 0) return "";
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (width === 0) return "";
  const formatRow = (row: ReadonlyArray<unknown>): string => {
    const padded = Array.from({ length: width }, (_, index) => escapeMarkdownCell(row[index] ?? ""));
    return `| ${padded.join(" | ")} |`;
  };
  const header = formatRow(rows[0]);
  const separator = `| ${Array.from({ length: width }, () => "---").join(" | ")} |`;
  const body = rows.slice(1).map(formatRow);
  return [header, separator, ...body].join("\n");
}

/**
 * Markdown テーブル文字列を 2 次元配列（`string[][]`）へパースする。
 * 区切り行（`| --- | ... |`）はスキップする。
 * @param markdown Markdown テキスト
 * @returns パースされた 2 次元配列
 */
export function parseMarkdownTable(markdown: string): string[][] {
  const lines = String(markdown ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));
  if (lines.length === 0) return [];
  return lines
    .filter((line, index) => {
      if (index !== 1) return true;
      const cells = splitMarkdownTableRow(line);
      return !cells.every((cell) => /^:?-{3,}:?$/.test(cell));
    })
    .map(splitMarkdownTableRow);
}

/**
 * `YYYY-MM-DD_<stem>` 形式のシートタイトルを日付とファイル名部分（stem）に分解する。
 * 形式に一致しない場合は `null` を返す。
 * @param title シートタイトル
 * @returns 分解結果、または不一致時は `null`
 */
export function parseSheetTitle(title: string): { date: string; stem: string } | null {
  const match = SHEET_TITLE_PATTERN.exec(title);
  if (!match) return null;
  return { date: match[1], stem: match[2] };
}

/**
 * 既存シートタイトル一覧から、指定タイトルと同じ stem を持ち日付がより古いシートを新しい順に返す。
 * @param titles 既存シートタイトル一覧
 * @param currentTitle 基準となるシートタイトル
 * @returns 日付降順に並んだ過去シートタイトルの配列
 */
export function earlierSheetTitles(titles: ReadonlyArray<string>, currentTitle: string): string[] {
  const current = parseSheetTitle(currentTitle);
  if (!current) return [];
  const stem = current.stem.toLowerCase();
  return titles
    .flatMap((title) => {
      const parsed = parseSheetTitle(title);
      if (!parsed || parsed.stem.toLowerCase() !== stem || parsed.date >= current.date) return [];
      return [{ title, date: parsed.date }];
    })
    .sort((left, right) => (left.date < right.date ? 1 : left.date > right.date ? -1 : 0))
    .map((item) => item.title);
}

/**
 * 金額列の合計を算出し、末尾に合計行を追加した新しい 2 次元配列を返す。
 * データ行または数値が無い場合はエラーを送出する。
 * @param rows ヘッダーを含む CSV の行データ
 * @returns 合計行が追加された新しい行データ
 */
export function appendTotalRow(rows: ReadonlyArray<ReadonlyArray<string>>): string[][] {
  if (rows.length < 2) throw new Error("合計する数値がありません");
  const column = amountColumnIndex(rows);
  let sum = 0;
  let count = 0;
  for (const row of rows.slice(1)) {
    const parsed = parseAmount(row[column] ?? "");
    if (parsed === null) continue;
    sum += parsed;
    count += 1;
  }
  if (count === 0) throw new Error("合計する数値がありません");

  const width = Math.max(
    rows.reduce((max, row) => Math.max(max, row.length), 0),
    column + 1,
  );
  const total = Array.from({ length: width }, () => "");
  if (column !== 0) total[0] = "合計";
  total[column] = formatTotal(sum);
  return [...rows.map((row) => [...row]), total];
}

/**
 * 「デビット支払い」カテゴリの行を集計し、末尾にデビット合計行を追加した新しい 2 次元配列を返す。
 * @param rows 行データ
 * @returns デビット支払い合計行が追加された新しい行データ
 */
export function appendDebitTotalRow(rows: ReadonlyArray<ReadonlyArray<string>>): string[][] {
  let sum = 0;
  for (const row of rows.slice(1)) {
    if (String(row[DEBIT_CATEGORY_COLUMN_INDEX] ?? "").trim() !== DEBIT_CATEGORY) {
      continue;
    }
    const parsed = parseAmount(row[DEBIT_AMOUNT_COLUMN_INDEX] ?? "");
    if (parsed === null) continue;
    sum += parsed;
  }

  const width = Math.max(
    rows.reduce((max, row) => Math.max(max, row.length), 0),
    DEBIT_CATEGORY_COLUMN_INDEX + 1,
  );
  const debitTotal = Array.from({ length: width }, () => "");
  debitTotal[DEBIT_AMOUNT_COLUMN_INDEX] = formatTotal(sum);
  debitTotal[DEBIT_CATEGORY_COLUMN_INDEX] = DEBIT_TOTAL_LABEL;
  return [...rows.map((row) => [...row]), debitTotal];
}

/**
 * 「現金」「現金支払い」カテゴリの行を集計し、末尾に現金支払い合計行を追加した新しい 2 次元配列を返す。
 * @param rows 行データ
 * @returns 現金支払い合計行が追加された新しい行データ
 */
export function appendCashTotalRow(rows: ReadonlyArray<ReadonlyArray<string>>): string[][] {
  let sum = 0;
  for (const row of rows.slice(1)) {
    const category = String(row[CASH_CATEGORY_COLUMN_INDEX] ?? "").trim();
    if (!CASH_CATEGORIES.has(category)) continue;
    const parsed = parseAmount(row[CASH_AMOUNT_COLUMN_INDEX] ?? "");
    if (parsed === null) continue;
    sum += parsed;
  }

  const width = Math.max(
    rows.reduce((max, row) => Math.max(max, row.length), 0),
    CASH_TOTAL_LABEL_COLUMN_INDEX + 1,
  );
  const cashTotal = Array.from({ length: width }, () => "");
  cashTotal[CASH_AMOUNT_COLUMN_INDEX] = formatTotal(sum);
  cashTotal[CASH_TOTAL_LABEL_COLUMN_INDEX] = CASH_TOTAL_LABEL;
  return [...rows.map((row) => [...row]), cashTotal];
}

/**
 * 行データ内の最古の日付から累計対象月（`YYYY-MM`）を返す。
 * 日付列が存在しない場合は `null` を返し、日付値が 1 件も無い場合はエラーを送出する。
 * @param rows 行データ
 * @returns `YYYY-MM` 形式の月文字列、または日付列が無い場合は `null`
 */
export function cumulativeMonth(rows: ReadonlyArray<ReadonlyArray<string>>): string | null {
  const dateIndex = dateColumnIndex(rows);
  if (dateIndex === null) return null;
  let earliest: string | null = null;
  for (const row of rows.slice(1)) {
    const date = rowDate(row, dateIndex);
    if (date !== null && (earliest === null || date < earliest)) earliest = date;
  }
  if (earliest === null) throw new Error("日付がありません");
  return earliest.slice(0, 7);
}

/**
 * シートの行データに指定された月（`YYYY-MM`）の日付を持つ行が含まれているかを判定する。
 * @param rows シートの行データ
 * @param month 判定対象月（`YYYY-MM`）
 * @returns 指定月の行が存在すれば `true`
 */
export function sheetHasCumulativeMonth(rows: ReadonlyArray<ReadonlyArray<string>>, month: string): boolean {
  const dateIndex = dateColumnIndex(rows);
  if (dateIndex === null) return false;
  return rows.slice(1).some((row) => {
    const date = rowDate(row, dateIndex);
    return date !== null && date.slice(0, 7) === month;
  });
}

/**
 * 当週シートおよび過去同月シートの金額を合算し、累計 合計・デビット 合計・現金 合計の 3 行を末尾に追加する。
 * 日付列が無い場合は行データのコピーをそのまま返す。
 * @param rows 当週の行データ
 * @param previousSheets 過去シートの行データ配列
 * @returns 累計行が追加された新しい行データ
 */
export function appendCumulativeRows(
  rows: ReadonlyArray<ReadonlyArray<string>>,
  previousSheets: ReadonlyArray<ReadonlyArray<ReadonlyArray<string>>> = [],
): string[][] {
  const month = cumulativeMonth(rows);
  if (month === null) return rows.map((row) => [...row]);

  const sums = monthSums(rows, month);
  for (const sheet of previousSheets) {
    if (!sheetHasCumulativeMonth(sheet, month)) break;
    const previous = monthSums(sheet, month);
    sums.total += previous.total;
    sums.debit += previous.debit;
    sums.cash += previous.cash;
  }

  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  return [
    ...rows.map((row) => [...row]),
    cumulativeRow(width, sums.total, CUMULATIVE_TOTAL_LABEL),
    cumulativeRow(width, sums.debit, CUMULATIVE_DEBIT_LABEL),
    cumulativeRow(width, sums.cash, CUMULATIVE_CASH_LABEL),
  ];
}
