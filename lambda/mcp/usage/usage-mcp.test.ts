import { expect, test } from "vitest";
import type { WeeklyUsageItem } from "../../claude/types.ts";
import type { JsonRpcSuccessResponse, McpToolCallResult } from "../types.ts";
import { createUsageMcpFetchHandler } from "./index.ts";
import { createUsageMcpServer } from "./server.ts";

const sampleItem: WeeklyUsageItem = {
  pk: "WEEK#2026-W48",
  callCount: 3,
  inputTokens: 1200,
  outputTokens: 300,
  estimatedUsd: 125_000,
  byFunction: {
    index: { callCount: 2, inputTokens: 800, outputTokens: 200, estimatedUsd: 80_000 },
    weekly: { callCount: 1, inputTokens: 400, outputTokens: 100, estimatedUsd: 45_000 },
  },
};

test("usage_get_weekly_report と usage_record_weekly と resources/read が動作する", async () => {
  const recordedCalls: unknown[] = [];
  const server = createUsageMcpServer({
    tableName: "notes-pipeline-claude-usage",
    getWeeklyUsage: async () => sampleItem,
    fetchUsdJpyRate: async () => 150.0,
    recordWeeklyUsage: async (options) => {
      recordedCalls.push(options);
      return { pk: "WEEK#2026-W48", estimatedUsd: "0.0100" };
    },
  });

  const listRes = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  })) as JsonRpcSuccessResponse;
  const tools = (listRes.result as { tools: Array<{ name: string }> }).tools;
  expect(tools.map((t) => t.name)).toEqual(["usage_get_weekly_report", "usage_record_weekly"]);

  const reportRes = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "usage_get_weekly_report", arguments: { includeFxRate: true } },
  })) as JsonRpcSuccessResponse;
  const reportPayload = JSON.parse((reportRes.result as McpToolCallResult).content[0].text) as {
    pk: string;
    usdJpyRate: number;
    report: string;
  };
  expect(reportPayload.pk).toBe("WEEK#2026-W48");
  expect(reportPayload.usdJpyRate).toBe(150.0);
  expect(reportPayload.report).toContain("Claude利用量 (2026-W48)");
  expect(reportPayload.report).toContain("150.0円");

  const readRes = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 3,
    method: "resources/read",
    params: { uri: "usage://claude/weekly" },
  })) as JsonRpcSuccessResponse;
  expect((readRes.result as { contents: Array<{ text: string }> }).contents[0].text).toContain(
    "Claude利用量 (2026-W48)",
  );

  await server.handleMessage({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "usage_record_weekly",
      arguments: {
        functionName: "weekly",
        modelId: "claude-haiku-5-5",
        inputTokens: 100,
        outputTokens: 50,
      },
    },
  });
  expect(recordedCalls).toHaveLength(1);
});

test("createUsageMcpFetchHandler は Bearer トークン認証を検証する", async () => {
  const handler = createUsageMcpFetchHandler({
    server: createUsageMcpServer({
      getWeeklyUsage: async () => null,
      fetchUsdJpyRate: async () => null,
    }),
    resolveAuthToken: async () => "usage-secret-token",
  });

  const unauthRes = await handler.fetch(
    new Request("https://usage.infra-practice.jp/", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    }),
  );
  expect(unauthRes.status).toBe(401);

  const okRes = await handler.fetch(
    new Request("https://usage.infra-practice.jp/", {
      method: "POST",
      headers: { authorization: "Bearer usage-secret-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
    }),
  );
  expect(okRes.status).toBe(200);
  expect(await okRes.json()).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
});
