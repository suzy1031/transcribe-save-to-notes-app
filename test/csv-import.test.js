import assert from "node:assert/strict";
import test from "node:test";
import {
  appendCashTotalRow,
  appendCumulativeRows,
  appendDebitTotalRow,
  appendTotalRow,
  earlierSheetTitles,
  gridSize,
  isCsvFile,
  parseCsv,
  sheetTitle,
  sheetValuesRange,
  spreadsheetAppLink,
  valuesRange,
} from "../lambda/csv/csv.ts";
import { importCsvFiles } from "../lambda/csv/csv-import.ts";
import { csvImportSummaryMessage, EMPTY_CSV_MESSAGE } from "../lambda/line/helper.ts";
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

test("appendCashTotalRow はC列が現金または現金支払いの行のみA列を合計し最終行へ追加する", () => {
  assert.deepEqual(
    appendCashTotalRow([
      ["金額", "日付", "内容", "カテゴリー"],
      ["¥1,200", "2026-11-01", "現金", "食費"],
      ["500", "2026-11-02", " 現金支払い ", "日用品"],
      ["￥800円", "2026-11-03", "書籍", "現金"],
      ["", "2026-11-04", "現金", "空欄"],
      ["300", "2026-11-05", "現金以外", "交通"],
    ]),
    [
      ["金額", "日付", "内容", "カテゴリー"],
      ["¥1,200", "2026-11-01", "現金", "食費"],
      ["500", "2026-11-02", " 現金支払い ", "日用品"],
      ["￥800円", "2026-11-03", "書籍", "現金"],
      ["", "2026-11-04", "現金", "空欄"],
      ["300", "2026-11-05", "現金以外", "交通"],
      ["1700", "", "", "現金支払い"],
    ],
  );
});

test("appendCashTotalRow は現金の行が0件ならA列を0として最終行を追加する", () => {
  assert.deepEqual(
    appendCashTotalRow([
      ["品目", "金額"],
      ["pen", "1200"],
      ["合計", "1200"],
      ["0", "", "", "デビット支払い合計"],
    ]),
    [
      ["品目", "金額"],
      ["pen", "1200"],
      ["合計", "1200"],
      ["0", "", "", "デビット支払い合計"],
      ["0", "", "", "現金支払い"],
    ],
  );
});

test("appendCashTotalRow は現金行のA列が数値でないと失敗する", () => {
  assert.throws(
    () =>
      appendCashTotalRow([
        ["金額", "日付", "内容", "カテゴリー"],
        ["未定", "2026-11-01", "現金", "食費"],
      ]),
    /金額にできない値です/,
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

test("appendCumulativeRows は同じ月の前週明細を足し、現金が無い前週は0になる", () => {
  const weekly = appendCashTotalRow(
    appendDebitTotalRow(
      appendTotalRow([
        ["金額", "日付", "内容", "カテゴリー"],
        ["1000", "2026-11-15", "ランチ", "デビット支払い"],
        ["300", "2026-11-16", "現金", "食費"],
      ]),
    ),
  );
  assert.deepEqual(
    appendCumulativeRows(weekly, [
      [
        ["金額", "日付", "内容", "カテゴリー"],
        ["2000", "2026-11-08", "書籍", "デビット支払い"],
        ["5000", "2026-10-31", "先月", "デビット支払い"],
        ["1500", "", "", "デビット支払い合計"],
      ],
    ]),
    [...weekly, ["3300", "", "", "累計 合計"], ["3000", "", "", "デビット 合計"], ["300", "", "", "現金 合計"]],
  );
});

test("appendCumulativeRows は月をまたぐ週では早い月の日付だけを累計する", () => {
  const weekly = appendCashTotalRow(
    appendDebitTotalRow(
      appendTotalRow([
        ["金額", "日付", "内容", "カテゴリー"],
        ["100", "2026-11-29", "現金", "食費"],
        ["50", "2026-11-30", "ランチ", "デビット支払い"],
        ["999", "2026-12-01", "書籍", "デビット支払い"],
        ["10", "2026-12-05", "現金", "交通"],
      ]),
    ),
  );
  assert.deepEqual(
    appendCumulativeRows(weekly, [
      [
        ["金額", "日付", "内容", "カテゴリー"],
        ["1000", "2026-11-22", "ランチ", "デビット支払い"],
      ],
    ]),
    [...weekly, ["1150", "", "", "累計 合計"], ["1050", "", "", "デビット 合計"], ["100", "", "", "現金 合計"]],
  );
});

test("appendCumulativeRows は翌月の累計に前週のその月の明細だけを足す", () => {
  const weekly = appendCashTotalRow(
    appendDebitTotalRow(
      appendTotalRow([
        ["金額", "日付", "内容", "カテゴリー"],
        ["200", "2026-12-06", "現金", "食費"],
        ["80", "2026-12-07", "ランチ", "デビット支払い"],
      ]),
    ),
  );
  assert.deepEqual(
    appendCumulativeRows(weekly, [
      [
        ["金額", "日付", "内容", "カテゴリー"],
        ["100", "2026-11-29", "現金", "食費"],
        ["50", "2026-11-30", "ランチ", "デビット支払い"],
        ["999", "2026-12-01", "書籍", "デビット支払い"],
        ["10", "2026-12-05", "現金", "交通"],
      ],
      [
        ["金額", "日付", "内容", "カテゴリー"],
        ["1000", "2026-11-22", "ランチ", "デビット支払い"],
      ],
    ]),
    [...weekly, ["1289", "", "", "累計 合計"], ["1079", "", "", "デビット 合計"], ["210", "", "", "現金 合計"]],
  );
});

test("appendCumulativeRows は日付列が無いCSVに累計行を付けない", () => {
  const weekly = appendCashTotalRow(
    appendDebitTotalRow(
      appendTotalRow([
        ["name", "qty"],
        ["pen", "2"],
      ]),
    ),
  );
  assert.deepEqual(
    appendCumulativeRows(weekly, [
      [
        ["金額", "日付"],
        ["9", "2026-11-01"],
      ],
    ]),
    weekly,
  );
});

test("appendCumulativeRows は対象月の金額が数値でないと失敗する", () => {
  assert.throws(
    () =>
      appendCumulativeRows([
        ["金額", "日付", "内容", "カテゴリー"],
        ["未定", "2026-11-15", "現金", "食費"],
      ]),
    /金額にできない値です/,
  );
});

test("appendCumulativeRows はスラッシュ区切りの日付を同じ月として足す", () => {
  const weekly = appendCashTotalRow(
    appendDebitTotalRow(
      appendTotalRow([
        ["金額", "日付", "内容", "カテゴリー"],
        ["100", "2026/11/17", "現金", "食費"],
        ["999", "2026/12/01", "書籍", "デビット支払い"],
      ]),
    ),
  );
  assert.deepEqual(
    appendCumulativeRows(weekly, [
      [
        ["金額", "日付", "内容", "カテゴリー"],
        ["40", "2026-11-08", "ランチ", "デビット支払い"],
      ],
    ]),
    [...weekly, ["140", "", "", "累計 合計"], ["40", "", "", "デビット 合計"], ["100", "", "", "現金 合計"]],
  );
});

test("earlierSheetTitles は同じファイル名で今回より前のシートを新しい順に返す", () => {
  assert.deepEqual(
    earlierSheetTitles(
      ["2026-11-22_household", "2026-11-15_Household", "2026-11-22_other", "2026-12-06_household", "notes"],
      "2026-11-29_household",
    ),
    ["2026-11-22_household", "2026-11-15_Household"],
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
        ["0", "", "", "現金支払い"],
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

test("日付があるCSVは同じ月の前週シートだけを読んで累計行を足す", async () => {
  const reads = [];
  let written = [];
  const result = await importCsvFiles({
    files: [{ id: "file-1", name: "household.csv" }],
    download: async () => Buffer.from("金額,日付,内容,カテゴリー\n100,2026-11-15,現金,食費\n"),
    existingSheetTitles: ["2026-11-08_household", "2026-10-25_household", "2026-10-18_household"],
    readSheet: async (title) => {
      reads.push(title);
      if (title === "2026-11-08_household") {
        return [
          ["金額", "日付", "内容", "カテゴリー"],
          ["40", "2026-11-08", "ランチ", "デビット支払い"],
        ];
      }
      return [
        ["金額", "日付", "内容", "カテゴリー"],
        ["9", "2026-10-25", "ランチ", "デビット支払い"],
      ];
    },
    writeSheet: async ({ title, rows }) => {
      assert.equal(title, "2026-11-15_household");
      written = rows;
    },
    moveToProcessed: async () => {},
    pushLine: async () => {},
    spreadsheetUrl: "googlesheets://https://docs.google.com/spreadsheets/d/sheet/edit",
    now: new Date("2026-11-15T01:00:00.000Z"),
  });
  assert.equal(result.imported, 1);
  assert.deepEqual(reads, ["2026-11-08_household", "2026-10-25_household"]);
  assert.deepEqual(written.at(-3), ["140", "", "", "累計 合計"]);
  assert.deepEqual(written.at(-2), ["40", "", "", "デビット 合計"]);
  assert.deepEqual(written.at(-1), ["100", "", "", "現金 合計"]);
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

test("getSheetValues はシート全体の値を文字列で返す", async () => {
  const fetchImpl = async (url) => {
    assert.equal(String(url).includes(`/values/${encodeURIComponent(sheetValuesRange("it's"))}`), true);
    return new Response(
      JSON.stringify({
        values: [
          ["金額", "日付"],
          [1200, "2026-11-01"],
        ],
      }),
      { status: 200 },
    );
  };
  const sheets = createSheetsClient({
    authClient: { getAccessToken: async () => "token" },
    fetchImpl,
  });
  assert.deepEqual(await sheets.getSheetValues("sheet-id", "it's"), [
    ["金額", "日付"],
    ["1200", "2026-11-01"],
  ]);
});
