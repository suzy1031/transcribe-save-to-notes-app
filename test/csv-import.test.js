import assert from "node:assert/strict";
import test from "node:test";
import {
  appendDebitTotalRow,
  appendTotalRow,
  gridSize,
  isCsvFile,
  parseCsv,
  sheetTitle,
  spreadsheetAppLink,
  valuesRange,
} from "../lambda/csv/csv.ts";
import { importCsvFiles } from "../lambda/csv/csv-import.ts";
import { csvImportSummaryMessage, EMPTY_CSV_MESSAGE } from "../lambda/line/helper/line.ts";
import { createSheetsClient } from "../lambda/sheets/sheets.ts";

test("parseCsv は引用符、カンマ、セル内改行、BOM、CRLFを読む", () => {
  const text = '\uFEFFname,note\r\n"a,b","line1\nline2"\r\nplain,"say ""hi"""\r\n';
  assert.deepEqual(parseCsv(text), [
    ["name", "note"],
    ["a,b", "line1\nline2"],
    ["plain", 'say "hi"'],
  ]);
});

test("parseCsv は閉じていない引用符を拒否する", () => {
  assert.throws(() => parseCsv('"open'), /引用符が閉じていません/);
});

test("sheetTitle は日付とファイル名から作り、使えない文字を除く", () => {
  assert.equal(sheetTitle({ date: "2026-11-15", fileName: "sales.csv" }), "2026-11-15_sales");
  assert.equal(sheetTitle({ date: "2026-11-15", fileName: "a:b?c*.csv" }), "2026-11-15_abc");
  assert.equal(sheetTitle({ date: "2026-11-15", fileName: ".csv" }), "2026-11-15_csv");
  const long = `${"あ".repeat(120)}.csv`;
  assert.equal(sheetTitle({ date: "2026-11-15", fileName: long }).length, 100);
});

test("appendTotalRow は金額列を合計し、カンマと円記号を外す", () => {
  assert.deepEqual(
    appendTotalRow([
      ["品目", "金額"],
      ["pen", "¥1,200"],
      ["note", "￥800円"],
      ["empty", ""],
    ]),
    [
      ["品目", "金額"],
      ["pen", "¥1,200"],
      ["note", "￥800円"],
      ["empty", ""],
      ["合計", "2000"],
    ],
  );
});

test("appendTotalRow は金額列が無いとき右端の数値列を合計する", () => {
  assert.deepEqual(
    appendTotalRow([
      ["name", "qty"],
      ["pen", "2"],
      ["note", "3"],
    ]),
    [
      ["name", "qty"],
      ["pen", "2"],
      ["note", "3"],
      ["合計", "5"],
    ],
  );
});

test("appendTotalRow は金額列に数値でない値があると失敗する", () => {
  assert.throws(
    () =>
      appendTotalRow([
        ["品目", "金額"],
        ["pen", "未定"],
      ]),
    /金額にできない値です/,
  );
});

test("appendTotalRow はヘッダーだけのCSVを失敗にする", () => {
  assert.throws(() => appendTotalRow([["金額"]]), /合計する数値がありません/);
});

test("appendDebitTotalRow はD列がデビット支払いの行のみA列を合計し最終行へ追加する", () => {
  assert.deepEqual(
    appendDebitTotalRow([
      ["金額", "日付", "内容", "カテゴリー"],
      ["¥1,200", "2026-11-01", "ランチ", "デビット支払い"],
      ["500", "2026-11-02", "カフェ", "現金"],
      ["￥800円", "2026-11-03", "書籍", "デビット支払い"],
      ["", "2026-11-04", "空欄", "デビット支払い"],
    ]),
    [
      ["金額", "日付", "内容", "カテゴリー"],
      ["¥1,200", "2026-11-01", "ランチ", "デビット支払い"],
      ["500", "2026-11-02", "カフェ", "現金"],
      ["￥800円", "2026-11-03", "書籍", "デビット支払い"],
      ["", "2026-11-04", "空欄", "デビット支払い"],
      ["2000", "", "", "デビット支払い合計"],
    ],
  );
});

test("appendDebitTotalRow はデビット支払いの行が0件ならA列を0として最終行を追加する", () => {
  assert.deepEqual(
    appendDebitTotalRow([
      ["品目", "金額"],
      ["pen", "1200"],
      ["合計", "1200"],
    ]),
    [
      ["品目", "金額"],
      ["pen", "1200"],
      ["合計", "1200"],
      ["0", "", "", "デビット支払い合計"],
    ],
  );
});

test("appendDebitTotalRow はデビット支払い行のA列が数値でないと失敗する", () => {
  assert.throws(
    () =>
      appendDebitTotalRow([
        ["金額", "日付", "内容", "カテゴリー"],
        ["未定", "2026-11-01", "ランチ", "デビット支払い"],
      ]),
    /金額にできない値です/,
  );
});

test("spreadsheetAppLink はSheetsアプリで開くURLを返す", () => {
  assert.equal(spreadsheetAppLink("sheet-1"), "googlesheets://https://docs.google.com/spreadsheets/d/sheet-1/edit");
});

test("isCsvFile はcsv拡張子かtext/csvを受け、Googleスプレッドシートは除く", () => {
  assert.equal(isCsvFile({ name: "week.csv", mimeType: "application/octet-stream" }), true);
  assert.equal(isCsvFile({ name: "week.CSV", mimeType: "text/plain" }), true);
  assert.equal(isCsvFile({ name: "week", mimeType: "text/csv" }), true);
  assert.equal(isCsvFile({ name: "week.csv", mimeType: "application/vnd.google-apps.spreadsheet" }), false);
  assert.equal(isCsvFile({ name: "week.png", mimeType: "image/png" }), false);
});

test("CSVが0件ならシートを作らず対象なしを通知する", async () => {
  const messages = [];
  const result = await importCsvFiles({
    files: [],
    download: async () => {
      throw new Error("download");
    },
    existingSheetTitles: [],
    writeSheet: async () => {
      throw new Error("write");
    },
    moveToProcessed: async () => {
      throw new Error("move");
    },
    pushLine: async (text) => {
      messages.push(text);
    },
    spreadsheetUrl: "googlesheets://https://docs.google.com/spreadsheets/d/sheet/edit",
  });
  assert.deepEqual(result, { imported: 0, failed: 0, failures: [] });
  assert.deepEqual(messages, [EMPTY_CSV_MESSAGE]);
});

test("CSVを新しいシートへ書き、成功後に移動してLINEする", async () => {
  const order = [];
  const result = await importCsvFiles({
    files: [{ id: "file-1", name: "sales.csv" }],
    download: async () => Buffer.from("name,qty\npen,2\n"),
    existingSheetTitles: [],
    writeSheet: async ({ title, rows }) => {
      order.push("write");
      assert.equal(title, "2026-11-15_sales");
      assert.deepEqual(rows, [
        ["name", "qty"],
        ["pen", "2"],
        ["合計", "2"],
        ["0", "", "", "デビット支払い合計"],
      ]);
    },
    moveToProcessed: async (file) => {
      order.push(`move:${file.id}`);
    },
    pushLine: async (text) => {
      order.push(text);
    },
    spreadsheetUrl: "googlesheets://https://docs.google.com/spreadsheets/d/sheet/edit",
    now: new Date("2026-11-15T01:00:00.000Z"),
  });
  assert.equal(result.imported, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(order, [
    "write",
    "move:file-1",
    csvImportSummaryMessage({
      imported: 1,
      failed: 0,
      spreadsheetUrl: "googlesheets://https://docs.google.com/spreadsheets/d/sheet/edit",
      failures: [],
    }),
  ]);
});

test("同名シートがあるファイルは上書きも移動もしない", async () => {
  let downloaded = false;
  let moved = false;
  const result = await importCsvFiles({
    files: [{ id: "file-1", name: "sales.csv" }],
    download: async () => {
      downloaded = true;
      return Buffer.from("a\n");
    },
    existingSheetTitles: ["2026-11-15_Sales"],
    writeSheet: async () => {
      throw new Error("write");
    },
    moveToProcessed: async () => {
      moved = true;
    },
    pushLine: async () => {},
    spreadsheetUrl: "googlesheets://https://docs.google.com/spreadsheets/d/sheet/edit",
    now: new Date("2026-11-15T01:00:00.000Z"),
  });
  assert.equal(downloaded, false);
  assert.equal(moved, false);
  assert.equal(result.imported, 0);
  assert.equal(result.failed, 1);
  assert.match(result.failures[0].reason, /既にあります/);
});

test("書き込みに失敗したファイルは移動しない", async () => {
  let moved = false;
  const result = await importCsvFiles({
    files: [{ id: "file-1", name: "sales.csv" }],
    download: async () => Buffer.from("name,qty\npen,2\n"),
    existingSheetTitles: [],
    writeSheet: async () => {
      throw new Error("sheets down");
    },
    moveToProcessed: async () => {
      moved = true;
    },
    pushLine: async () => {},
    spreadsheetUrl: "googlesheets://https://docs.google.com/spreadsheets/d/sheet/edit",
    now: new Date("2026-11-15T01:00:00.000Z"),
  });
  assert.equal(moved, false);
  assert.equal(result.failed, 1);
  assert.equal(result.failures[0].reason, "sheets down");
});

test("addSheetWithValues はシートを追加してRAWで書き込む", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
    if (String(url).includes(":batchUpdate")) {
      return new Response(
        JSON.stringify({ replies: [{ addSheet: { properties: { sheetId: 7, title: "2026-11-15_sales" } } }] }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ updatedCells: 2 }), { status: 200 });
  };
  const sheets = createSheetsClient({
    authClient: { getAccessToken: async () => "token" },
    fetchImpl,
  });
  await sheets.addSheetWithValues({
    spreadsheetId: "sheet-id",
    title: "2026-11-15_sales",
    rows: [["name"], ["pen"]],
  });
  assert.equal(calls[1].url.includes("valueInputOption=RAW"), true);
  assert.deepEqual(calls[1].body.values, [["name"], ["pen"]]);
  assert.deepEqual(gridSize([["name"], ["pen"]]), { rowCount: 2, columnCount: 1 });
  assert.equal(valuesRange("it's"), "'it''s'!A1");
});
