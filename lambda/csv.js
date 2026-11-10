import path from "node:path";
import { TOKYO_TIME_ZONE } from "./const.js";

const SHEET_TITLE_MAX = 100;
const INVALID_SHEET_CHARS = /[:\\/?*[\]]/g;

export function tokyoDate(now = new Date(), timeZone = TOKYO_TIME_ZONE) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isCsvFile(file) {
  const mime = file.mimeType ?? "";
  if (mime.startsWith("application/vnd.google-apps.")) return false;
  const extension = path.extname(file.name ?? "").toLowerCase();
  return mime === "text/csv" || extension === ".csv";
}

export function parseCsv(text) {
  const source = String(text).replace(/^\uFEFF/, "");
  if (source === "") return [];

  const rows = [];
  let row = [];
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

export function sheetTitle({ date, fileName }) {
  const stem = path.basename(fileName ?? "", path.extname(fileName ?? ""));
  const cleaned = stem
    .replace(INVALID_SHEET_CHARS, "")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/^\.+/, "")
    .trim();
  return `${date}_${cleaned || "csv"}`.slice(0, SHEET_TITLE_MAX);
}

export function spreadsheetUrl(spreadsheetId) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

export function valuesRange(title) {
  return `'${String(title).replaceAll("'", "''")}'!A1`;
}

export function gridSize(rows) {
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 1);
  return { rowCount: Math.max(rows.length, 1), columnCount };
}
