import { expect, test } from "vitest";
import { csvImportSummaryMessage, EMPTY_CSV_MESSAGE } from "../line/helper.ts";
import { createSheetsClient } from "../sheets/sheets.ts";
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
} from "./csv.ts";
import { importCsvFiles } from "./csv-import.ts";

test("parseCsv は引用符、カンマ、セル内改行、BOM、CRLFを読む", () => {
  const text = '\uFEFFname,note\r\n"a,b","line1\nline2"\r\nplain,"say ""hi"""\r\n';
  expect(parseCsv(text)).toEqual([
    ["name", "note"],
    ["a,b", "line1\nline2"],
    ["plain", 'say "hi"'],
  ]);
});

test("parseCsv は閉じていない引用符を拒否する", () => {
  expect(() => parseCsv('"open')).toThrow(/引用符が閉じていません/);
});

test("sheetTitle は日付とファイル名から作り、使えない文字を除く", () => {
  expect(sheetTitle({ date: "2026-11-15", fileName: "sales.csv" })).toBe("2026-11-15_sales");
  expect(sheetTitle({ date: "2026-11-15", fileName: "a:b?c*.csv" })).toBe("2026-11-15_abc");
  expect(sheetTitle({ date: "2026-11-15", fileName: ".csv" })).toBe("2026-11-15_csv");
  const long = `${"あ".repeat(120)}.csv`;
  expect(sheetTitle({ date: "2026-11-15", fileName: long }).length).toBe(100);
});

test("appendTotalRow は金額列を合計し、カンマと円記号を外す", () => {
  expect(
    appendTotalRow([
      ["品目", "金額"],
      ["pen", "¥1,200"],
      ["note", "￥800円"],
      ["empty", ""],
    ]),
  ).toEqual([
    ["品目", "金額"],
    ["pen", "¥1,200"],
    ["note", "￥800円"],
    ["empty", ""],
    ["合計", "2000"],
  ]);
});

test("appendTotalRow は金額列が無いとき右端の数値列を合計する", () => {
  expect(
    appendTotalRow([
      ["name", "qty"],
      ["pen", "2"],
      ["note", "3"],
    ]),
  ).toEqual([
    ["name", "qty"],
    ["pen", "2"],
    ["note", "3"],
    ["合計", "5"],
  ]);
});

test("appendTotalRow は金額列に数値でない値があると失敗する", () => {
  expect(() =>
    appendTotalRow([
      ["品目", "金額"],
      ["pen", "未定"],
    ]),
  ).toThrow(/金額にできない値です/);
});

test("appendTotalRow はヘッダーだけのCSVを失敗にする", () => {
  expect(() => appendTotalRow([["金額"]])).toThrow(/合計する数値がありません/);
});

test("appendDebitTotalRow はD列がデビット支払いの行のみA列を合計し最終行へ追加する", () => {
  expect(
    appendDebitTotalRow([
      ["金額", "日付", "内容", "カテゴリー"],
      ["¥1,200", "2026-11-01", "ランチ", "デビット支払い"],
      ["500", "2026-11-02", "カフェ", "現金"],
      ["￥800円", "2026-11-03", "書籍", "デビット支払い"],
      ["", "2026-11-04", "空欄", "デビット支払い"],
    ]),
  ).toEqual([
    ["金額", "日付", "内容", "カテゴリー"],
    ["¥1,200", "2026-11-01", "ランチ", "デビット支払い"],
    ["500", "2026-11-02", "カフェ", "現金"],
    ["￥800円", "2026-11-03", "書籍", "デビット支払い"],
    ["", "2026-11-04", "空欄", "デビット支払い"],
    ["2000", "", "", "デビット支払い合計"],
  ]);
});

test("appendDebitTotalRow はデビット支払いの行が0件ならA列を0として最終行を追加する", () => {
  expect(
    appendDebitTotalRow([
      ["品目", "金額"],
      ["pen", "1200"],
      ["合計", "1200"],
    ]),
  ).toEqual([
    ["品目", "金額"],
    ["pen", "1200"],
    ["合計", "1200"],
    ["0", "", "", "デビット支払い合計"],
  ]);
});

test("appendCashTotalRow はC列が現金または現金支払いの行のみA列を合計し最終行へ追加する", () => {
  expect(
    appendCashTotalRow([
      ["金額", "日付", "内容", "カテゴリー"],
      ["¥1,200", "2026-11-01", "現金", "食費"],
      ["500", "2026-11-02", " 現金支払い ", "日用品"],
      ["￥800円", "2026-11-03", "書籍", "現金"],
      ["", "2026-11-04", "現金", "空欄"],
      ["300", "2026-11-05", "現金以外", "交通"],
    ]),
  ).toEqual([
    ["金額", "日付", "内容", "カテゴリー"],
    ["¥1,200", "2026-11-01", "現金", "食費"],
    ["500", "2026-11-02", " 現金支払い ", "日用品"],
    ["￥800円", "2026-11-03", "書籍", "現金"],
    ["", "2026-11-04", "現金", "空欄"],
    ["300", "2026-11-05", "現金以外", "交通"],
    ["1700", "", "", "現金支払い"],
  ]);
});

test("appendCashTotalRow は現金の行が0件ならA列を0として最終行を追加する", () => {
  expect(
    appendCashTotalRow([
      ["品目", "金額"],
      ["pen", "1200"],
      ["合計", "1200"],
      ["0", "", "", "デビット支払い合計"],
    ]),
  ).toEqual([
    ["品目", "金額"],
    ["pen", "1200"],
    ["合計", "1200"],
    ["0", "", "", "デビット支払い合計"],
    ["0", "", "", "現金支払い"],
  ]);
});

test("appendCashTotalRow は現金行のA列が数値でないと失敗する", () => {
  expect(() =>
    appendCashTotalRow([
      ["金額", "日付", "内容", "カテゴリー"],
      ["未定", "2026-11-01", "現金", "食費"],
    ]),
  ).toThrow(/金額にできない値です/);
});

test("appendDebitTotalRow はデビット支払い行のA列が数値でないと失敗する", () => {
  expect(() =>
    appendDebitTotalRow([
      ["金額", "日付", "内容", "カテゴリー"],
      ["未定", "2026-11-01", "ランチ", "デビット支払い"],
    ]),
  ).toThrow(/金額にできない値です/);
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
  expect(
    appendCumulativeRows(weekly, [
      [
        ["金額", "日付", "内容", "カテゴリー"],
        ["2000", "2026-11-08", "書籍", "デビット支払い"],
        ["5000", "2026-10-31", "先月", "デビット支払い"],
        ["1500", "", "", "デビット支払い合計"],
      ],
    ]),
  ).toEqual([
    ...weekly,
    ["3300", "", "", "累計 合計"],
    ["3000", "", "", "デビット 合計"],
    ["300", "", "", "現金 合計"],
  ]);
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
  expect(
    appendCumulativeRows(weekly, [
      [
        ["金額", "日付", "内容", "カテゴリー"],
        ["1000", "2026-11-22", "ランチ", "デビット支払い"],
      ],
    ]),
  ).toEqual([
    ...weekly,
    ["1150", "", "", "累計 合計"],
    ["1050", "", "", "デビット 合計"],
    ["100", "", "", "現金 合計"],
  ]);
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
  expect(
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
  ).toEqual([
    ...weekly,
    ["1289", "", "", "累計 合計"],
    ["1079", "", "", "デビット 合計"],
    ["210", "", "", "現金 合計"],
  ]);
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
  expect(
    appendCumulativeRows(weekly, [
      [
        ["金額", "日付"],
        ["9", "2026-11-01"],
      ],
    ]),
  ).toEqual(weekly);
});

test("appendCumulativeRows は対象月の金額が数値でないと失敗する", () => {
  expect(() =>
    appendCumulativeRows([
      ["金額", "日付", "内容", "カテゴリー"],
      ["未定", "2026-11-15", "現金", "食費"],
    ]),
  ).toThrow(/金額にできない値です/);
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
  expect(
    appendCumulativeRows(weekly, [
      [
        ["金額", "日付", "内容", "カテゴリー"],
        ["40", "2026-11-08", "ランチ", "デビット支払い"],
      ],
    ]),
  ).toEqual([...weekly, ["140", "", "", "累計 合計"], ["40", "", "", "デビット 合計"], ["100", "", "", "現金 合計"]]);
});

test("earlierSheetTitles は同じファイル名で今回より前のシートを新しい順に返す", () => {
  expect(
    earlierSheetTitles(
      ["2026-11-22_household", "2026-11-15_Household", "2026-11-22_other", "2026-12-06_household", "notes"],
      "2026-11-29_household",
    ),
  ).toEqual(["2026-11-22_household", "2026-11-15_Household"]);
});

test("spreadsheetAppLink はSheetsアプリで開くURLを返す", () => {
  expect(spreadsheetAppLink("sheet-1")).toBe("googlesheets://https://docs.google.com/spreadsheets/d/sheet-1/edit");
});

test("isCsvFile はcsv拡張子かtext/csvを受け、Googleスプレッドシートは除く", () => {
  expect(isCsvFile({ name: "week.csv", mimeType: "application/octet-stream" })).toBe(true);
  expect(isCsvFile({ name: "week.CSV", mimeType: "text/plain" })).toBe(true);
  expect(isCsvFile({ name: "week", mimeType: "text/csv" })).toBe(true);
  expect(isCsvFile({ name: "week.csv", mimeType: "application/vnd.google-apps.spreadsheet" })).toBe(false);
  expect(isCsvFile({ name: "week.png", mimeType: "image/png" })).toBe(false);
});

test("CSVが0件ならシートを作らず対象なしを通知する", async () => {
  const messages: string[] = [];
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
  expect(result).toEqual({ imported: 0, failed: 0, failures: [] });
  expect(messages).toEqual([EMPTY_CSV_MESSAGE]);
});

test("CSVを新しいシートへ書き、成功後に移動してLINEする", async () => {
  const order: string[] = [];
  const result = await importCsvFiles({
    files: [{ id: "file-1", name: "sales.csv" }],
    download: async () => Buffer.from("name,qty\npen,2\n"),
    existingSheetTitles: [],
    writeSheet: async ({ title, rows }) => {
      order.push("write");
      expect(title).toBe("2026-11-15_sales");
      expect(rows).toEqual([
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
  expect(result.imported).toBe(1);
  expect(result.failed).toBe(0);
  expect(order).toEqual([
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
  const reads: string[] = [];
  let written: string[][] = [];
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
      expect(title).toBe("2026-11-15_household");
      written = rows;
    },
    moveToProcessed: async () => {},
    pushLine: async () => {},
    spreadsheetUrl: "googlesheets://https://docs.google.com/spreadsheets/d/sheet/edit",
    now: new Date("2026-11-15T01:00:00.000Z"),
  });
  expect(result.imported).toBe(1);
  expect(reads).toEqual(["2026-11-08_household", "2026-10-25_household"]);
  expect(written.at(-3)).toEqual(["140", "", "", "累計 合計"]);
  expect(written.at(-2)).toEqual(["40", "", "", "デビット 合計"]);
  expect(written.at(-1)).toEqual(["100", "", "", "現金 合計"]);
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
  expect(downloaded).toBe(false);
  expect(moved).toBe(false);
  expect(result.imported).toBe(0);
  expect(result.failed).toBe(1);
  expect(result.failures[0].reason).toMatch(/既にあります/);
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
  expect(moved).toBe(false);
  expect(result.failed).toBe(1);
  expect(result.failures[0].reason).toBe("sheets down");
});

test("addSheetWithValues はシートを追加してRAWで書き込む", async () => {
  const calls: Array<{ url: string; body: { values?: string[][] } | null }> = [];
  const fetchImpl: typeof fetch = async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body ? JSON.parse(String(options.body)) : null });
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
  expect(calls[1].url.includes("valueInputOption=RAW")).toBe(true);
  expect(calls[1].body?.values).toEqual([["name"], ["pen"]]);
  expect(gridSize([["name"], ["pen"]])).toEqual({ rowCount: 2, columnCount: 1 });
  expect(valuesRange("it's")).toBe("'it''s'!A1");
});

test("getSheetValues はシート全体の値を文字列で返す", async () => {
  const fetchImpl: typeof fetch = async (url) => {
    expect(String(url).includes(`/values/${encodeURIComponent(sheetValuesRange("it's"))}`)).toBe(true);
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
  expect(await sheets.getSheetValues("sheet-id", "it's")).toEqual([
    ["金額", "日付"],
    ["1200", "2026-11-01"],
  ]);
});
