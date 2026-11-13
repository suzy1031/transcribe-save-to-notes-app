import assert from "node:assert/strict";
import test from "node:test";
import { craftAppDocumentLink } from "../lambda/craft/helper.ts";
import { processKindleBooks, summaryDocumentState } from "../lambda/kindle/kindle.ts";
import { kindleRunSummaryMessage } from "../lambda/line/helper.ts";

test("summaryDocumentState は0件または1件のドキュメントを受け付ける", () => {
  assert.deepEqual(summaryDocumentState([]), { action: "create" });
  assert.deepEqual(summaryDocumentState([{ id: "doc-1", title: "要約" }]), {
    action: "append",
    documentId: "doc-1",
  });
  assert.equal(
    summaryDocumentState([
      { id: "a", title: "a" },
      { id: "b", title: "b" },
    ]).action,
    "error",
  );
});

test("kindleRunSummaryMessage にフォルダ名とCraftリンクが列挙される", () => {
  const text = kindleRunSummaryMessage({
    summarized: 2,
    failed: 0,
    links: [
      {
        folderName: "kindle_book",
        appLink: craftAppDocumentLink("space-1", "doc-1"),
      },
    ],
  });
  assert.match(text, /Kindle要約完了/);
  assert.match(text, /処理: 2枚/);
  assert.match(text, /kindle_book/);
  assert.match(text, /craftdocs:\/\/open\?/);
});

test("processKindleBooks はCraftのないフォルダをスキップし1ドキュメントに追記する", async () => {
  const moves = [];
  const appends = [];
  const creates = [];
  const bookFolders = [
    { id: "drive-1", name: "kindle_missing_craft" },
    { id: "drive-2", name: "kindle_book" },
  ];

  const summary = await processKindleBooks({
    bookFolders,
    listImages: async (folderId) => {
      if (folderId === "drive-1") {
        return [{ id: "img-0", name: "skip.png", mimeType: "image/png" }];
      }
      if (folderId === "drive-2") {
        return [{ id: "img-1", name: "page.png", mimeType: "image/png" }];
      }
      return [];
    },
    download: async () => Buffer.from("image"),
    findCraftFolderId: async (name) => (name === "kindle_book" ? "craft-folder" : null),
    listCraftDocuments: async () => [{ id: "doc-1", title: "要約" }],
    createSummaryDocument: async (input) => {
      creates.push(input);
      return "doc-new";
    },
    appendSummary: async (input) => {
      appends.push(input);
    },
    summarizeImage: async () => "要約本文",
    ensureProcessedFolder: async () => "processed-1",
    moveImageToProcessed: async (input) => {
      moves.push(input);
    },
  });

  assert.equal(summary.foldersSkippedNoCraft, 1);
  assert.equal(summary.imagesSummarized, 1);
  assert.equal(creates.length, 0);
  assert.deepEqual(appends, [{ documentId: "doc-1", markdown: "要約本文" }]);
  assert.equal(moves.length, 1);
  assert.deepEqual(summary.links, [{ folderName: "kindle_book", documentId: "doc-1" }]);
});

test("processKindleBooks はCraftフォルダが空のとき要約ドキュメントを作成する", async () => {
  const creates = [];
  const summary = await processKindleBooks({
    bookFolders: [{ id: "drive-1", name: "kindle_book" }],
    listImages: async () => [{ id: "img-1", name: "page.png", mimeType: "image/png" }],
    download: async () => Buffer.from("image"),
    findCraftFolderId: async () => "craft-folder",
    listCraftDocuments: async () => [],
    createSummaryDocument: async (input) => {
      creates.push(input);
      return "doc-new";
    },
    appendSummary: async () => {},
    summarizeImage: async () => "初回要約",
    ensureProcessedFolder: async () => "processed-1",
    moveImageToProcessed: async () => {},
  });

  assert.equal(summary.imagesSummarized, 1);
  assert.deepEqual(creates, [{ folderId: "craft-folder", markdown: "初回要約" }]);
  assert.deepEqual(summary.links, [{ folderName: "kindle_book", documentId: "doc-new" }]);
});
