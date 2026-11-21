import { expect, test } from "vitest";
import type { ObsidianClient, ObsidianListedNote, SaveNoteInput } from "../../obsidian/types.ts";
import { unwrapLambdaMcpEvent } from "../index.ts";
import { processStdioLine } from "../stdio.ts";
import type { JsonRpcErrorResponse, JsonRpcSuccessResponse, McpToolCallResult } from "../types.ts";
import { createObsidianMcpServer } from "./server.ts";

function createFakeObsidianClient() {
  const notes = new Map<string, string>();
  const savedCalls: Array<{ type: "create" | "append"; input: SaveNoteInput }> = [];
  const listedNotes: ObsidianListedNote[] = [
    {
      id: "00_daily_notes/2026-11-20.md",
      key: "00_daily_notes/2026-11-20.md",
      title: "2026-11-20",
      createdDate: "2026-11-20",
    },
    {
      id: "00_daily_notes/2026-11-21.md",
      key: "00_daily_notes/2026-11-21.md",
      title: "2026-11-21",
      createdDate: "2026-11-21",
    },
  ];

  const client: ObsidianClient = {
    async createNote(input) {
      savedCalls.push({ type: "create", input });
      const key = `${input.folder}/${input.title.replace(/\//g, "-")}.md`;
      notes.set(key, input.markdown);
      return key;
    },
    async saveOrAppendNote(input) {
      savedCalls.push({ type: "append", input });
      const key = `${input.folder}/${input.title.replace(/\//g, "-")}.md`;
      const existing = notes.get(key);
      notes.set(key, existing ? `${existing}\n\n${input.markdown}` : input.markdown);
      return key;
    },
    async listNotes({ folder, createdDateGte, createdDateLte }) {
      return listedNotes.filter((n) => {
        if (!n.key.startsWith(`${folder}/`)) return false;
        if (createdDateGte && n.createdDate < createdDateGte) return false;
        if (createdDateLte && n.createdDate > createdDateLte) return false;
        return true;
      });
    },
    async readMarkdown(key) {
      const content = notes.get(key);
      if (content === undefined) {
        throw new Error(`NoSuchKey: ${key}`);
      }
      return content;
    },
  };

  return { client, notes, savedCalls };
}

test("initialize と notifications/initialized を処理する", async () => {
  const { client } = createFakeObsidianClient();
  const server = createObsidianMcpServer({ obsidian: client, vaultName: "ks-vault" });

  const initRes = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26" },
  })) as JsonRpcSuccessResponse;

  expect(initRes.id).toBe(1);
  expect(initRes.result).toEqual({
    protocolVersion: "2025-03-26",
    capabilities: { tools: {}, resources: {} },
    serverInfo: { name: "obsidian-s3-mcp", version: "1.0.0" },
  });

  const notifRes = await server.handleMessage({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  expect(notifRes).toBeNull();
});

test("tools/list は Obsidian ドメインの 5 ツールを返す", async () => {
  const { client } = createFakeObsidianClient();
  const server = createObsidianMcpServer({ obsidian: client });

  const res = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  })) as JsonRpcSuccessResponse;

  const tools = (res.result as { tools: Array<{ name: string }> }).tools;
  expect(tools.map((t) => t.name)).toEqual([
    "obsidian_create_note",
    "obsidian_save_or_append_note",
    "obsidian_list_notes",
    "obsidian_read_note",
    "obsidian_get_app_link",
  ]);
});

test("obsidian_create_note と obsidian_save_or_append_note と obsidian_read_note が連携して動作する", async () => {
  const { client, savedCalls } = createFakeObsidianClient();
  const server = createObsidianMcpServer({ obsidian: client, vaultName: "ks-vault" });

  const createRes = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "obsidian_create_note",
      arguments: {
        folder: "00_daily_notes",
        title: "2026/11/21",
        markdown: "## 朝のメモ",
        tags: ["daily"],
      },
    },
  })) as JsonRpcSuccessResponse;

  const createResult = createRes.result as McpToolCallResult;
  expect(JSON.parse(createResult.content[0].text)).toEqual({
    key: "00_daily_notes/2026-11-21.md",
    appLink: "obsidian://open?vault=ks-vault&file=00_daily_notes%2F2026-11-21",
  });
  expect(savedCalls[0].type).toBe("create");

  await server.handleMessage({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "obsidian_save_or_append_note",
      arguments: {
        folder: "00_daily_notes",
        title: "2026/11/21",
        markdown: "## 夜のメモ",
      },
    },
  });

  const readRes = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: {
      name: "obsidian_read_note",
      arguments: { key: "00_daily_notes/2026-11-21.md" },
    },
  })) as JsonRpcSuccessResponse;

  const readResult = readRes.result as McpToolCallResult;
  expect(readResult.content[0].text).toBe("## 朝のメモ\n\n## 夜のメモ");
});

test("obsidian_list_notes と obsidian_get_app_link が動作する", async () => {
  const { client } = createFakeObsidianClient();
  const server = createObsidianMcpServer({ obsidian: client, vaultName: "ks-vault" });

  const listRes = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: {
      name: "obsidian_list_notes",
      arguments: {
        folder: "00_daily_notes",
        createdDateGte: "2026-11-21",
      },
    },
  })) as JsonRpcSuccessResponse;

  const listPayload = JSON.parse((listRes.result as McpToolCallResult).content[0].text);
  expect(listPayload.notes).toHaveLength(1);
  expect(listPayload.notes[0].title).toBe("2026-11-21");

  const linkRes = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: {
      name: "obsidian_get_app_link",
      arguments: { key: "00_daily_notes/2026-11-21.md" },
    },
  })) as JsonRpcSuccessResponse;

  const linkPayload = JSON.parse((linkRes.result as McpToolCallResult).content[0].text);
  expect(linkPayload.appLink).toBe("obsidian://open?vault=ks-vault&file=00_daily_notes%2F2026-11-21");
});

test("resources/templates/list と resources/read で obsidian://note/{key} を読み取れる", async () => {
  const { client, notes } = createFakeObsidianClient();
  notes.set("00_daily_notes/2026-11-21.md", "リソース本文");
  const server = createObsidianMcpServer({ obsidian: client });

  const tplRes = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 8,
    method: "resources/templates/list",
  })) as JsonRpcSuccessResponse;
  const templates = (tplRes.result as { resourceTemplates: Array<{ uriTemplate: string }> }).resourceTemplates;
  expect(templates[0].uriTemplate).toBe("obsidian://note/{key}");

  const readRes = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 9,
    method: "resources/read",
    params: { uri: "obsidian://note/00_daily_notes/2026-11-21.md" },
  })) as JsonRpcSuccessResponse;

  expect(readRes.result).toEqual({
    contents: [
      {
        uri: "obsidian://note/00_daily_notes/2026-11-21.md",
        mimeType: "text/markdown",
        text: "リソース本文",
      },
    ],
  });
});

test("handleHttpRequest と processStdioLine と unwrapLambdaMcpEvent が正しく動作する", async () => {
  const { client } = createFakeObsidianClient();
  const server = createObsidianMcpServer({ obsidian: client });

  const httpResponse = await server.handleHttpRequest(
    new Request("http://localhost/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 10, method: "ping" }),
    }),
  );
  expect(httpResponse.status).toBe(200);
  expect(await httpResponse.json()).toEqual({ jsonrpc: "2.0", id: 10, result: {} });

  const stdioOut = await processStdioLine(server, JSON.stringify({ jsonrpc: "2.0", id: 11, method: "unknown_method" }));
  const parsedStdio = JSON.parse(stdioOut ?? "") as JsonRpcErrorResponse;
  expect(parsedStdio.error.code).toBe(-32601);

  const unwrapped = unwrapLambdaMcpEvent({
    body: JSON.stringify({ jsonrpc: "2.0", id: 12, method: "ping" }),
    isBase64Encoded: false,
  });
  expect(unwrapped).toEqual({ jsonrpc: "2.0", id: 12, method: "ping" });
});
