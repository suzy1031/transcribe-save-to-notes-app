import assert from "node:assert/strict";
import test from "node:test";
import { createCraftClient } from "../lambda/craft/craft.ts";
import {
  connectionSpaceId,
  craftAppDocumentLink,
  documentPayload,
  documentsQuery,
  findFolderIds,
  moveDocumentsPayload,
} from "../lambda/craft/helper/craft.ts";

test("craftAppDocumentLink はCraftアプリでドキュメントを開くURLを返す", () => {
  assert.equal(craftAppDocumentLink("space-1", "doc-1"), "craftdocs://open?spaceId=space-1&blockId=doc-1");
});

test("connectionSpaceId はGET /connectionからspace idを読み取る", () => {
  assert.equal(connectionSpaceId({ space: { id: "space-1" } }), "space-1");
  assert.throws(() => connectionSpaceId({ space: {} }), /space id/);
});

test("documentPayload はfolder idでdaily_note_transcribe向けペイロードを組み立てる", () => {
  assert.deepEqual(documentPayload("朝のメモ", "folder-daily"), {
    documents: [{ title: "朝のメモ" }],
    destination: { folderId: "folder-daily" },
  });
});

test("findFolderIds はネストフォルダを走査し重複を報告する", () => {
  const payload = {
    items: [
      {
        id: "root",
        name: "Other",
        folders: [{ id: "daily", name: "daily_note_transcribe" }],
      },
    ],
  };
  assert.deepEqual(findFolderIds(payload, "daily_note_transcribe"), ["daily"]);
  assert.equal(
    findFolderIds(
      {
        items: [
          { id: "a", name: "daily_note_transcribe" },
          { id: "b", name: "daily_note_transcribe" },
        ],
      },
      "daily_note_transcribe",
    ).length,
    2,
  );
});

test("createDocument はfolder idをPOSTしてからmarkdownを送る", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({
      url,
      body: options.body ? JSON.parse(options.body) : undefined,
      method: options.method,
      authorization: options.headers.authorization,
    });
    if (url.endsWith("/documents")) {
      return new Response(JSON.stringify({ items: [{ id: "doc-1" }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  };
  const craft = createCraftClient({
    baseUrl: "https://connect.craft.do/links/example/api/v1",
    apiKey: "test-key",
    fetchImpl,
  });
  const documentId = await craft.createDocument({
    title: "朝のメモ",
    markdown: "本文",
    folderId: "folder-daily",
  });
  assert.equal(documentId, "doc-1");
  assert.equal(calls[0].authorization, "Bearer test-key");
  assert.equal(calls[1].authorization, "Bearer test-key");
  assert.equal(calls[0].body.destination.folderId, "folder-daily");
  assert.deepEqual(calls[1].body, {
    markdown: "本文",
    position: { position: "end", pageId: "doc-1" },
  });
});

test("listDocuments はフォルダと作成日でフィルタする", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, accept: options.headers.accept, method: options.method });
    return new Response(
      JSON.stringify({
        items: [{ id: "doc-1", title: "月曜" }, { documentId: "doc-2", title: "火曜" }, { title: "idなし" }],
      }),
      { status: 200 },
    );
  };
  const craft = createCraftClient({
    baseUrl: "https://connect.craft.do/links/example/api/v1",
    apiKey: "test-key",
    fetchImpl,
  });
  const documents = await craft.listDocuments({
    folderId: "folder-daily",
    createdDateGte: "2026-10-25",
  });
  assert.deepEqual(documents, [
    { id: "doc-1", title: "月曜" },
    { id: "doc-2", title: "火曜" },
  ]);
  assert.equal(
    calls[0].url,
    `https://connect.craft.do/links/example/api/v1${documentsQuery({
      folderId: "folder-daily",
      createdDateGte: "2026-10-25",
    })}`,
  );
  assert.equal(calls[0].method, "GET");
});

test("listDocuments はcreatedDateLteで作成日の上限を指定できる", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method });
    return new Response(JSON.stringify({ items: [{ id: "doc-1", title: "週次まとめ" }] }), {
      status: 200,
    });
  };
  const craft = createCraftClient({
    baseUrl: "https://connect.craft.do/links/example/api/v1",
    apiKey: "test-key",
    fetchImpl,
  });
  const documents = await craft.listDocuments({
    folderId: "folder-summaries",
    createdDateGte: "2026-11-01",
    createdDateLte: "2026-11-01",
  });
  assert.deepEqual(documents, [{ id: "doc-1", title: "週次まとめ" }]);
  assert.equal(
    calls[0].url,
    `https://connect.craft.do/links/example/api/v1${documentsQuery({
      folderId: "folder-summaries",
      createdDateGte: "2026-11-01",
      createdDateLte: "2026-11-01",
    })}`,
  );
});

test("readMarkdown はドキュメントをmarkdownとして取得する", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, accept: options.headers.accept });
    return new Response("# 本文", { status: 200 });
  };
  const craft = createCraftClient({
    baseUrl: "https://connect.craft.do/links/example/api/v1/",
    apiKey: "test-key",
    fetchImpl,
  });
  const markdown = await craft.readMarkdown("doc/1");
  assert.equal(markdown, "# 本文");
  assert.equal(calls[0].accept, "text/markdown");
  assert.equal(calls[0].url, "https://connect.craft.do/links/example/api/v1/blocks?id=doc%2F1");
});

test("appendMarkdown はページ末尾にmarkdownをPOSTする", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, body: JSON.parse(options.body) });
    return new Response("{}", { status: 200 });
  };
  const craft = createCraftClient({
    baseUrl: "https://connect.craft.do/links/example/api/v1",
    apiKey: "test-key",
    fetchImpl,
  });
  await craft.appendMarkdown({ pageId: "doc-1", markdown: "追記" });
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "https://connect.craft.do/links/example/api/v1/blocks");
  assert.deepEqual(calls[0].body, {
    markdown: "追記",
    position: { position: "end", pageId: "doc-1" },
  });
});

test("moveDocuments は移動先folder idを指定する", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, method: options.method, body: JSON.parse(options.body) });
    return new Response("{}", { status: 200 });
  };
  const craft = createCraftClient({
    baseUrl: "https://connect.craft.do/links/example/api/v1",
    apiKey: "test-key",
    fetchImpl,
  });
  await craft.moveDocuments({ documentIds: ["doc-1", "doc-2"], folderId: "folder-processed" });
  assert.equal(calls[0].method, "PUT");
  assert.equal(calls[0].url, "https://connect.craft.do/links/example/api/v1/documents/move");
  assert.deepEqual(calls[0].body, moveDocumentsPayload(["doc-1", "doc-2"], "folder-processed"));
});
