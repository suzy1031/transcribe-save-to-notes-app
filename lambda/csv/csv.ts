import path from "node:path";
import { TOKYO_TIME_ZONE } from "../shared/const.ts";
import type { FileLike } from "./types.ts";

const SHEET_TITLE_MAX = 100;
const INVALID_SHEET_CHARS = /[:\\/?*[\]]/g;

export function tokyoDate(now: Date = new Date(), timeZone: string = TOKYO_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isCsvFile(file: FileLike): boolean {
  const mime = file.mimeType ?? "";
  if (mime.startsWith("application/vnd.google-apps.")) return false;
  const extension = path.extname(file.name ?? "").toLowerCase();
  return mime === "text/csv" || extension === ".csv";
}

export function parseCsv(text: unknown): string[][] {
  const source = String(text).replace(/^\uFEFF/, "");
  if (source === "") return [];

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field === "") {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (char === "\r" && source[index + 1] === "\n") index += 1;
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

export function spreadsheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

export function spreadsheetAppLink(spreadsheetId: string): string {
  return `googlesheets://${spreadsheetUrl(spreadsheetId)}`;
}

export function valuesRange(title: unknown): string {
  return `'${quotedSheetTitle(title)}'!A1`;
}

export function sheetValuesRange(title: unknown): string {
  return `'${quotedSheetTitle(title)}'`;
}

function quotedSheetTitle(title: unknown): string {
  return String(title).replaceAll("'", "''");
}

const SHEET_TITLE_PATTERN = /^(\d{4}-\d{2}-\d{2})_(.+)$/;

export function parseSheetTitle(title: string): { date: string; stem: string } | null {
  const match = SHEET_TITLE_PATTERN.exec(title);
  if (!match) return null;
  return { date: match[1], stem: match[2] };
}

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

export function gridSize(rows: ReadonlyArray<ReadonlyArray<unknown>>): {
  rowCount: number;
  columnCount: number;
} {
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 1);
  return { rowCount: Math.max(rows.length, 1), columnCount };
}

const AMOUNT_PATTERN = /^-?\d+(\.\d+)?$/;
const DEBIT_CATEGORY = "デビット支払い";
const DEBIT_TOTAL_LABEL = "デビット支払い合計";
const DEBIT_AMOUNT_COLUMN_INDEX = 0;
const DEBIT_CATEGORY_COLUMN_INDEX = 3;
const CASH_CATEGORIES = new Set(["現金", "現金支払い"]);
const CASH_TOTAL_LABEL = "現金支払い";
const CASH_AMOUNT_COLUMN_INDEX = 0;
const CASH_CATEGORY_COLUMN_INDEX = 2;
const CASH_TOTAL_LABEL_COLUMN_INDEX = 3;
const CUMULATIVE_TOTAL_LABEL = "累計 合計";
const CUMULATIVE_DEBIT_LABEL = "デビット 合計";
const CUMULATIVE_CASH_LABEL = "現金 合計";
const DATE_HEADER = "日付";
const DATE_PATTERN = /^(\d{4})([-/])(\d{2})\2(\d{2})$/;

function parseAmount(value: unknown): number | null {
  const trimmed = String(value ?? "").trim();
  if (trimmed === "") return null;
  const normalized = trimmed.replace(/[¥￥円,\s]/g, "");
  if (!AMOUNT_PATTERN.test(normalized)) {
    throw new Error(`金額にできない値です: ${trimmed}`);
  }
  return Number(normalized);
}

function formatTotal(sum: number): string {
  if (Number.isInteger(sum)) return String(sum);
  return String(Math.round(sum * 100) / 100);
}

function amountColumnIndex(rows: ReadonlyArray<ReadonlyArray<unknown>>): number {
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

function dateColumnIndex(rows: ReadonlyArray<ReadonlyArray<unknown>>): number | null {
  if (rows.length === 0) return null;
  const index = rows[0].findIndex((cell) => String(cell).trim() === DATE_HEADER);
  return index === -1 ? null : index;
}

function rowDate(row: ReadonlyArray<unknown>, dateIndex: number): string | null {
  const value = String(row[dateIndex] ?? "").trim();
  if (value === "") return null;
  const match = DATE_PATTERN.exec(value);
  if (!match) throw new Error(`日付にできない値です: ${value}`);
  return `${match[1]}-${match[3]}-${match[4]}`;
}

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

export function sheetHasCumulativeMonth(rows: ReadonlyArray<ReadonlyArray<string>>, month: string): boolean {
  const dateIndex = dateColumnIndex(rows);
  if (dateIndex === null) return false;
  return rows.slice(1).some((row) => {
    const date = rowDate(row, dateIndex);
    return date !== null && date.slice(0, 7) === month;
  });
}

function monthSums(
  rows: ReadonlyArray<ReadonlyArray<string>>,
  month: string,
): {
  total: number;
  debit: number;
  cash: number;
} {
  const dateIndex = dateColumnIndex(rows);
  const sums = { total: 0, debit: 0, cash: 0 };
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

function cumulativeRow(width: number, amount: number, label: string): string[] {
  const row = Array.from({ length: Math.max(width, CASH_TOTAL_LABEL_COLUMN_INDEX + 1) }, () => "");
  row[CASH_AMOUNT_COLUMN_INDEX] = formatTotal(amount);
  row[CASH_TOTAL_LABEL_COLUMN_INDEX] = label;
  return row;
}

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
