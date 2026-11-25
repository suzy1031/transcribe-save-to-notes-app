import { expect, test } from "vitest";
import type { JsonRpcSuccessResponse, McpToolCallResult } from "../types.ts";
import { createLineMcpFetchHandler } from "./index.ts";
import { createLineMcpServer } from "./server.ts";

test("line_send_notification は文字数制限内で LINE Push を送信する", async () => {
  const sent: string[] = [];
  const server = createLineMcpServer({
    line: {
      async push(text) {
        sent.push(text);
      },
    },
  });

  const listRes = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
  })) as JsonRpcSuccessResponse;
  const tools = (listRes.result as { tools: Array<{ name: string }> }).tools;
  expect(tools.map((t) => t.name)).toEqual(["line_send_notification"]);

  const longText = "あ".repeat(5005);
  const callRes = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "line_send_notification",
      arguments: { text: longText },
    },
  })) as JsonRpcSuccessResponse;

  expect(sent).toHaveLength(1);
  expect(sent[0].length).toBe(5000);
  expect(JSON.parse((callRes.result as McpToolCallResult).content[0].text)).toEqual({
    sent: true,
    length: 5000,
  });
});

test("createLineMcpFetchHandler は Bearer トークン認証を検証する", async () => {
  const sent: string[] = [];
  const handler = createLineMcpFetchHandler({
    server: createLineMcpServer({
      line: {
        async push(text) {
          sent.push(text);
        },
      },
    }),
    resolveAuthToken: async () => "line-secret-token",
  });

  const unauthRes = await handler.fetch(
    new Request("https://line.infra-practice.jp/", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    }),
  );
  expect(unauthRes.status).toBe(401);

  const okRes = await handler.fetch(
    new Request("https://line.infra-practice.jp/", {
      method: "POST",
      headers: { authorization: "Bearer line-secret-token" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "line_send_notification", arguments: { text: "テスト通知" } },
      }),
    }),
  );
  expect(okRes.status).toBe(200);
  expect(sent).toEqual(["テスト通知"]);
});
