import { expect, test } from "vitest";
import type { JsonRpcSuccessResponse, McpToolCallResult } from "../types.ts";
import { createCsvMcpFetchHandler } from "./index.ts";
import { createCsvMcpServer } from "./server.ts";

test("household_format_csv_to_markdown は週次合計と月次累計付き Markdown テーブルを返す", async () => {
  const server = createCsvMcpServer();

  const listRes = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  })) as JsonRpcSuccessResponse;
  const tools = (listRes.result as { tools: Array<{ name: string }> }).tools;
  expect(tools.map((t) => t.name)).toEqual(["household_format_csv_to_markdown"]);

  const previousMarkdown = [
    "| 金額 | 内容 | 支払 | 区分 | 日付 |",
    "| --- | --- | --- | --- | --- |",
    "| 500 | ランチ | 現金 |  | 2026-11-10 |",
    "| 500 | 合計 |  |  |  |",
    "| 0 |  |  | デビット支払い合計 |  |",
    "| 500 |  |  | 現金支払い |  |",
  ].join("\n");

  const res = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "household_format_csv_to_markdown",
      arguments: {
        title: "2026-11-25_amounts",
        csvText: "金額,内容,支払,区分,日付\n1000,本,,デビット支払い,2026-11-20\n200,コーヒー,現金,,2026-11-21\n",
        previousNotes: [{ title: "2026-11-12_amounts", markdown: previousMarkdown }],
      },
    },
  })) as JsonRpcSuccessResponse;

  const toolResult = res.result as McpToolCallResult;
  expect(toolResult.isError).toBeUndefined();
  const payload = JSON.parse(toolResult.content[0].text) as {
    title: string;
    markdown: string;
    rowCount: number;
  };
  expect(payload.title).toBe("2026-11-25_amounts");
  expect(payload.markdown).toContain("| 1200 |  |  |  |  |");
  expect(payload.markdown).toContain("| 1000 |  |  | デビット支払い合計 |");
  expect(payload.markdown).toContain("| 200 |  |  | 現金支払い |");
  expect(payload.markdown).toContain("| 1700 |  |  | 累計 合計 |");
  expect(payload.markdown).toContain("| 700 |  |  | 現金 合計 |");
});

test("createCsvMcpFetchHandler は Bearer トークン認証を検証する", async () => {
  const handler = createCsvMcpFetchHandler({
    resolveAuthToken: async () => "csv-secret-token",
  });

  const unauthRes = await handler.fetch(
    new Request("https://csv.infra-practice.jp/", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    }),
  );
  expect(unauthRes.status).toBe(401);

  const okRes = await handler.fetch(
    new Request("https://csv.infra-practice.jp/", {
      method: "POST",
      headers: { authorization: "Bearer csv-secret-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
    }),
  );
  expect(okRes.status).toBe(200);
  expect(await okRes.json()).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
});
