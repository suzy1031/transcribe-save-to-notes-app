import path from "node:path";
import { TOKYO_TIME_ZONE } from "./const.ts";

const SHEET_TITLE_MAX = 100;
const INVALID_SHEET_CHARS = /[:\\/?*[\]]/g;

export interface FileLike {
  name?: string;
  mimeType?: string;
}

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
  return `'${String(title).replaceAll("'", "''")}'!A1`;
}

export function gridSize(rows: ReadonlyArray<ReadonlyArray<unknown>>): {
  rowCount: number;
  columnCount: number;
} {
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 1);
  return { rowCount: Math.max(rows.length, 1), columnCount };
}

const AMOUNT_PATTERN = /^-?\d+(\.\d+)?$/;

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
