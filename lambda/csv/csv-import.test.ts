import { expect, test } from "vitest";
import {
  appendCashTotalRow,
  appendCumulativeRows,
  appendDebitTotalRow,
  appendTotalRow,
  earlierSheetTitles,
  isCsvFile,
  parseCsv,
  parseMarkdownTable,
  rowsToMarkdownTable,
} from "../../shared/csv/csv.ts";
import { csvImportSettingsFromEnv, runCsvImportWithMcp } from "./csv-import.ts";

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

test("rowsToMarkdownTable と parseMarkdownTable は2次元配列とMarkdownテーブルを相互変換する", () => {
  const rows = [
    ["金額", "日付", "内容", "カテゴリー"],
    ["1200", "2026-11-15", "カフェ | ランチ", "デビット支払い"],
    ["1200", "", "", "合計"],
  ];
  const markdown = rowsToMarkdownTable(rows);
  expect(markdown).toBe(
    [
      "| 金額 | 日付 | 内容 | カテゴリー |",
      "| --- | --- | --- | --- |",
      "| 1200 | 2026-11-15 | カフェ \\| ランチ | デビット支払い |",
      "| 1200 |  |  | 合計 |",
    ].join("\n"),
  );
  expect(parseMarkdownTable(markdown)).toEqual(rows);
});

test("isCsvFile はcsv拡張子かtext/csvを受け、Googleスプレッドシートは除く", () => {
  expect(isCsvFile({ name: "week.csv", mimeType: "application/octet-stream" })).toBe(true);
  expect(isCsvFile({ name: "week.CSV", mimeType: "text/plain" })).toBe(true);
  expect(isCsvFile({ name: "week", mimeType: "text/csv" })).toBe(true);
  expect(isCsvFile({ name: "week.csv", mimeType: "application/vnd.google-apps.spreadsheet" })).toBe(false);
  expect(isCsvFile({ name: "week.png", mimeType: "image/png" })).toBe(false);
});

test("runCsvImportWithMcp は drive / csv / obsidian / line の mcp_servers を指定して Claude API を呼ぶ", async () => {
  const payloads: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  const res = await runCsvImportWithMcp({
    settings: csvImportSettingsFromEnv({}),
    credentials: {
      anthropicApiKey: "sk-ant-test",
      lineChannelAccessToken: "",
      lineUserId: "",
      mcpAuthToken: "mcp-csv-token",
    },
    now: new Date("2026-11-26T00:00:00Z"),
    fetchImpl: async (_url, options) => {
      payloads.push({
        headers: new Headers(options?.headers),
        body: JSON.parse(String(options?.body ?? "{}")),
      });
      return new Response(
        JSON.stringify({
          model: "claude-haiku-5-5",
          usage: { input_tokens: 30, output_tokens: 15 },
          content: [{ type: "text", text: "CSV取り込み完了" }],
        }),
        { status: 200 },
      );
    },
    recordUsage: async () => {},
  });

  expect(res.responseText).toBe("CSV取り込み完了");
  expect(payloads[0].headers.get("anthropic-beta")).toBe("mcp-client-2025-11-20");
  expect(payloads[0].body.mcp_servers).toEqual([
    {
      type: "url",
      url: "https://drive.infra-practice.jp/",
      name: "google-drive",
      authorization_token: "mcp-csv-token",
    },
    {
      type: "url",
      url: "https://csv.infra-practice.jp/",
      name: "household-csv",
      authorization_token: "mcp-csv-token",
    },
    {
      type: "url",
      url: "https://obsidian.infra-practice.jp/",
      name: "obsidian-s3",
      authorization_token: "mcp-csv-token",
    },
    {
      type: "url",
      url: "https://line.infra-practice.jp/",
      name: "line-notification",
      authorization_token: "mcp-csv-token",
    },
  ]);
});
