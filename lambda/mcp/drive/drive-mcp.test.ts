import { expect, test } from "vitest";
import type { DriveClient, DriveFile } from "../../drive/types.ts";
import type { JsonRpcErrorResponse, JsonRpcSuccessResponse, McpToolCallResult } from "../types.ts";
import { createDriveMcpFetchHandler } from "./index.ts";
import { createDriveMcpServer } from "./server.ts";

function createFakeDriveClient() {
  const folders = new Map<string, string>([
    ["00_notes_inbox", "folder-inbox"],
    ["01_processed", "folder-processed"],
    ["csv_inbox", "folder-csv"],
    ["kindle", "folder-kindle"],
  ]);
  const deletedIds: string[] = [];
  const movedCalls: Array<{ fileId: string; addParentId: string; removeParentId: string }> = [];
  const moveToProcessedCalls: Array<{
    fileId: string;
    inboxFolderId: string;
    processedFolderId: string;
    craftDocumentId: string;
  }> = [];
  let forbidDeleteIds = new Set<string>();

  const filesByFolder = new Map<string, DriveFile[]>([
    [
      "folder-inbox",
      [
        { id: "img-1", name: "scan1.png", mimeType: "image/png" },
        { id: "txt-1", name: "scan1.txt", mimeType: "text/plain" },
        { id: "txt-orphan", name: "already_done.txt", mimeType: "text/plain" },
      ],
    ],
    ["folder-csv", [{ id: "csv-1", name: "amounts.csv", mimeType: "text/csv" }]],
    [
      "folder-kindle",
      [
        { id: "book-1", name: "kindle_Clean_Code", mimeType: "application/vnd.google-apps.folder" },
        { id: "other-1", name: "misc", mimeType: "application/vnd.google-apps.folder" },
      ],
    ],
  ]);

  const fileContents = new Map<string, Buffer>([
    ["img-1", Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    ["csv-1", Buffer.from("date,amount\n2026-11-25,1000\n", "utf8")],
  ]);

  const client: DriveClient = {
    async findUniqueFolder(name) {
      const id = folders.get(name);
      return id ? { ok: true, id } : { ok: false, count: 0 };
    },
    async listImages(folderId) {
      return (filesByFolder.get(folderId) ?? []).filter((f) => f.mimeType?.startsWith("image/"));
    },
    async listCsvFiles(folderId) {
      return (filesByFolder.get(folderId) ?? []).filter((f) => f.name.endsWith(".csv"));
    },
    async listTextFiles(folderId) {
      return (filesByFolder.get(folderId) ?? []).filter((f) => f.name.endsWith(".txt"));
    },
    async download(fileId) {
      const buf = fileContents.get(fileId);
      if (!buf) throw new Error(`File not found: ${fileId}`);
      return buf;
    },
    async deleteFile(fileId) {
      if (forbidDeleteIds.has(fileId)) {
        const err = new Error("Drive API 403: Forbidden") as Error & { status?: number };
        err.status = 403;
        throw err;
      }
      deletedIds.push(fileId);
    },
    async moveFile(input) {
      movedCalls.push(input);
    },
    async moveToProcessed(input) {
      moveToProcessedCalls.push(input);
    },
    async listChildFolders(parentId) {
      return (filesByFolder.get(parentId) ?? []).filter((f) => f.mimeType === "application/vnd.google-apps.folder");
    },
    async listKindleBookFolders(parentId, prefix = "kindle_") {
      return (await this.listChildFolders(parentId)).filter((f) => f.name.startsWith(prefix));
    },
    async ensureChildFolder(_parentId, name) {
      return `child-${name}`;
    },
  };

  return {
    client,
    deletedIds,
    movedCalls,
    moveToProcessedCalls,
    setForbidDeleteIds: (ids: string[]) => {
      forbidDeleteIds = new Set(ids);
    },
  };
}

test("initialize と tools/list で Google Drive MCP の 4 ツールを返す", async () => {
  const { client } = createFakeDriveClient();
  const server = createDriveMcpServer({ drive: client });

  const initRes = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26" },
  })) as JsonRpcSuccessResponse;

  expect(initRes.result).toEqual({
    protocolVersion: "2025-03-26",
    capabilities: { tools: {} },
    serverInfo: { name: "google-drive-mcp", version: "1.0.0" },
  });

  const listRes = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
  })) as JsonRpcSuccessResponse;

  const tools = (listRes.result as { tools: Array<{ name: string }> }).tools;
  expect(tools.map((t) => t.name)).toEqual([
    "drive_list_inbox_files",
    "drive_download_file",
    "drive_mark_as_processed",
    "drive_cleanup_companion_texts",
  ]);
});

test("drive_list_inbox_files は images / csv / kindle の一覧を返す", async () => {
  const { client } = createFakeDriveClient();
  const server = createDriveMcpServer({ drive: client });

  const imgRes = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "drive_list_inbox_files", arguments: {} },
  })) as JsonRpcSuccessResponse;
  expect(JSON.parse((imgRes.result as McpToolCallResult).content[0].text)).toEqual({
    folderId: "folder-inbox",
    folderType: "images",
    files: [{ id: "img-1", name: "scan1.png", mimeType: "image/png" }],
  });

  const csvRes = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "drive_list_inbox_files", arguments: { folderType: "csv" } },
  })) as JsonRpcSuccessResponse;
  expect(JSON.parse((csvRes.result as McpToolCallResult).content[0].text)).toEqual({
    folderId: "folder-csv",
    folderType: "csv",
    files: [{ id: "csv-1", name: "amounts.csv", mimeType: "text/csv" }],
  });

  const kindleRes = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "drive_list_inbox_files", arguments: { folderType: "kindle" } },
  })) as JsonRpcSuccessResponse;
  expect(JSON.parse((kindleRes.result as McpToolCallResult).content[0].text)).toEqual({
    folderId: "folder-kindle",
    folderType: "kindle",
    folders: [{ id: "book-1", name: "kindle_Clean_Code", mimeType: "application/vnd.google-apps.folder" }],
  });
});

test("drive_download_file と drive_mark_as_processed と drive_cleanup_companion_texts が動作する", async () => {
  const { client, deletedIds, movedCalls, moveToProcessedCalls, setForbidDeleteIds } = createFakeDriveClient();
  const server = createDriveMcpServer({ drive: client });

  const dlImgRes = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: { name: "drive_download_file", arguments: { fileId: "img-1", encoding: "base64" } },
  })) as JsonRpcSuccessResponse;
  expect(JSON.parse((dlImgRes.result as McpToolCallResult).content[0].text)).toEqual({
    fileId: "img-1",
    encoding: "base64",
    byteLength: 4,
    content: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"),
  });

  const dlCsvRes = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: { name: "drive_download_file", arguments: { fileId: "csv-1", encoding: "utf8" } },
  })) as JsonRpcSuccessResponse;
  expect(JSON.parse((dlCsvRes.result as McpToolCallResult).content[0].text).content).toBe(
    "date,amount\n2026-11-25,1000\n",
  );

  // noteKey 指定時は moveToProcessed を呼ぶ
  await server.handleMessage({
    jsonrpc: "2.0",
    id: 8,
    method: "tools/call",
    params: {
      name: "drive_mark_as_processed",
      arguments: {
        fileId: "img-1",
        inboxFolderId: "folder-inbox",
        noteKey: "00_daily_notes/2026-11-25.md",
      },
    },
  });
  expect(moveToProcessedCalls).toEqual([
    {
      fileId: "img-1",
      inboxFolderId: "folder-inbox",
      processedFolderId: "folder-processed",
      craftDocumentId: "00_daily_notes/2026-11-25.md",
    },
  ]);

  // noteKey なし・processedFolderId 指定時は moveFile を呼ぶ
  await server.handleMessage({
    jsonrpc: "2.0",
    id: 9,
    method: "tools/call",
    params: {
      name: "drive_mark_as_processed",
      arguments: {
        fileId: "csv-1",
        inboxFolderId: "folder-csv",
        processedFolderId: "folder-csv-done",
      },
    },
  });
  expect(movedCalls).toContainEqual({
    fileId: "csv-1",
    addParentId: "folder-csv-done",
    removeParentId: "folder-csv",
  });

  // 孤立 .txt のみ削除（scan1.txt は scan1.png が残っているため削除しない）
  const cleanupRes = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 10,
    method: "tools/call",
    params: {
      name: "drive_cleanup_companion_texts",
      arguments: { inboxFolderId: "folder-inbox", processedFolderId: "folder-processed" },
    },
  })) as JsonRpcSuccessResponse;
  expect(JSON.parse((cleanupRes.result as McpToolCallResult).content[0].text)).toEqual({
    deleted: ["txt-orphan"],
    moved: [],
  });
  expect(deletedIds).toEqual(["txt-orphan"]);

  // 403 時は processedFolderId へ退避移動
  setForbidDeleteIds(["txt-orphan"]);
  const cleanup403Res = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 11,
    method: "tools/call",
    params: {
      name: "drive_cleanup_companion_texts",
      arguments: { inboxFolderId: "folder-inbox", processedFolderId: "folder-processed" },
    },
  })) as JsonRpcSuccessResponse;
  expect(JSON.parse((cleanup403Res.result as McpToolCallResult).content[0].text)).toEqual({
    deleted: [],
    moved: ["txt-orphan"],
  });
});

test("createDriveMcpFetchHandler は Bearer トークン認証と API Gateway HTTP API v2 イベントを処理する", async () => {
  const { client } = createFakeDriveClient();
  const server = createDriveMcpServer({ drive: client });
  const handler = createDriveMcpFetchHandler({
    server,
    resolveAuthToken: async () => "drive-secret-token",
  });

  const unauthorizedRes = await handler.fetch(
    new Request("https://drive.infra-practice.jp/", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    }),
  );
  expect(unauthorizedRes.status).toBe(401);

  const okRes = await handler.fetch(
    new Request("https://drive.infra-practice.jp/", {
      method: "POST",
      body: JSON.stringify({
        version: "2.0",
        routeKey: "POST /",
        headers: { authorization: "Bearer drive-secret-token" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
        isBase64Encoded: false,
      }),
    }),
  );
  expect(okRes.status).toBe(200);
  expect(await okRes.json()).toEqual({ jsonrpc: "2.0", id: 2, result: {} });

  const unknownMethodRes = (await server.handleMessage({
    jsonrpc: "2.0",
    id: 3,
    method: "unknown",
  })) as JsonRpcErrorResponse;
  expect(unknownMethodRes.error.code).toBe(-32601);
});
