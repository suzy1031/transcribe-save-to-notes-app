import { expect, test } from "vitest";
import { createCraftClient } from "./craft.ts";
import {
  connectionSpaceId,
  craftAppDocumentLink,
  documentPayload,
  documentsQuery,
  findFolderIds,
  moveDocumentsPayload,
} from "./helper.ts";

test("craftAppDocumentLink はCraftアプリでドキュメントを開くURLを返す", () => {
  expect(craftAppDocumentLink("space-1", "doc-1")).toBe("craftdocs://open?spaceId=space-1&blockId=doc-1");
});

test("connectionSpaceId はGET /connectionからspace idを読み取る", () => {
  expect(connectionSpaceId({ space: { id: "space-1" } })).toBe("space-1");
  expect(() => connectionSpaceId({ space: {} })).toThrow(/space id/);
});

test("documentPayload はfolder idでdaily_note_transcribe向けペイロードを組み立てる", () => {
  expect(documentPayload("朝のメモ", "folder-daily")).toEqual({
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
  expect(findFolderIds(payload, "daily_note_transcribe")).toEqual(["daily"]);
  expect(
    findFolderIds(
      {
        items: [
          { id: "a", name: "daily_note_transcribe" },
          { id: "b", name: "daily_note_transcribe" },
        ],
      },
      "daily_note_transcribe",
    ).length,
  ).toBe(2);
});

test("createDocument はfolder idをPOSTしてからmarkdownを送る", async () => {
  const calls: Array<{
    url: string;
    body?: { destination?: { folderId?: string }; markdown?: string; position?: unknown };
    method?: string;
    authorization: string;
  }> = [];
  const fetchImpl: typeof fetch = async (url, options) => {
    const urlStr = String(url);
    calls.push({
      url: urlStr,
      body: options?.body ? JSON.parse(String(options.body)) : undefined,
      method: options?.method,
      authorization: new Headers(options?.headers).get("authorization") ?? "",
    });
    if (urlStr.endsWith("/documents")) {
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
  expect(documentId).toBe("doc-1");
  expect(calls[0].authorization).toBe("Bearer test-key");
  expect(calls[1].authorization).toBe("Bearer test-key");
  expect(calls[0].body?.destination?.folderId).toBe("folder-daily");
  expect(calls[1].body).toEqual({
    markdown: "本文",
    position: { position: "end", pageId: "doc-1" },
  });
});

test("listDocuments はフォルダと作成日でフィルタする", async () => {
  const calls: Array<{ url: string; accept: string; method?: string }> = [];
  const fetchImpl: typeof fetch = async (url, options) => {
    calls.push({
      url: String(url),
      accept: new Headers(options?.headers).get("accept") ?? "",
      method: options?.method,
    });
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
  expect(documents).toEqual([
    { id: "doc-1", title: "月曜" },
    { id: "doc-2", title: "火曜" },
  ]);
  expect(calls[0].url).toBe(
    `https://connect.craft.do/links/example/api/v1${documentsQuery({
      folderId: "folder-daily",
      createdDateGte: "2026-10-25",
    })}`,
  );
  expect(calls[0].method).toBe("GET");
});

test("listDocuments はcreatedDateLteで作成日の上限を指定できる", async () => {
  const calls: Array<{ url: string; method?: string }> = [];
  const fetchImpl: typeof fetch = async (url, options) => {
    calls.push({ url: String(url), method: options?.method });
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
  expect(documents).toEqual([{ id: "doc-1", title: "週次まとめ" }]);
  expect(calls[0].url).toBe(
    `https://connect.craft.do/links/example/api/v1${documentsQuery({
      folderId: "folder-summaries",
      createdDateGte: "2026-11-01",
      createdDateLte: "2026-11-01",
    })}`,
  );
});

test("readMarkdown はドキュメントをmarkdownとして取得する", async () => {
  const calls: Array<{ url: string; accept: string }> = [];
  const fetchImpl: typeof fetch = async (url, options) => {
    calls.push({ url: String(url), accept: new Headers(options?.headers).get("accept") ?? "" });
    return new Response("# 本文", { status: 200 });
  };
  const craft = createCraftClient({
    baseUrl: "https://connect.craft.do/links/example/api/v1/",
    apiKey: "test-key",
    fetchImpl,
  });
  const markdown = await craft.readMarkdown("doc/1");
  expect(markdown).toBe("# 本文");
  expect(calls[0].accept).toBe("text/markdown");
  expect(calls[0].url).toBe("https://connect.craft.do/links/example/api/v1/blocks?id=doc%2F1");
});

test("appendMarkdown はページ末尾にmarkdownをPOSTする", async () => {
  const calls: Array<{ url: string; method?: string; body: unknown }> = [];
  const fetchImpl: typeof fetch = async (url, options) => {
    calls.push({
      url: String(url),
      method: options?.method,
      body: JSON.parse(String(options?.body ?? "")),
    });
    return new Response("{}", { status: 200 });
  };
  const craft = createCraftClient({
    baseUrl: "https://connect.craft.do/links/example/api/v1",
    apiKey: "test-key",
    fetchImpl,
  });
  await craft.appendMarkdown({ pageId: "doc-1", markdown: "追記" });
  expect(calls[0].method).toBe("POST");
  expect(calls[0].url).toBe("https://connect.craft.do/links/example/api/v1/blocks");
  expect(calls[0].body).toEqual({
    markdown: "追記",
    position: { position: "end", pageId: "doc-1" },
  });
});

test("moveDocuments は移動先folder idを指定する", async () => {
  const calls: Array<{ url: string; method?: string; body: unknown }> = [];
  const fetchImpl: typeof fetch = async (url, options) => {
    calls.push({
      url: String(url),
      method: options?.method,
      body: JSON.parse(String(options?.body ?? "")),
    });
    return new Response("{}", { status: 200 });
  };
  const craft = createCraftClient({
    baseUrl: "https://connect.craft.do/links/example/api/v1",
    apiKey: "test-key",
    fetchImpl,
  });
  await craft.moveDocuments({ documentIds: ["doc-1", "doc-2"], folderId: "folder-processed" });
  expect(calls[0].method).toBe("PUT");
  expect(calls[0].url).toBe("https://connect.craft.do/links/example/api/v1/documents/move");
  expect(calls[0].body).toEqual(moveDocumentsPayload(["doc-1", "doc-2"], "folder-processed"));
});
