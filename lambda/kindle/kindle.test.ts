import { expect, test } from "vitest";
import { craftAppDocumentLink } from "../craft/helper.ts";
import { kindleRunSummaryMessage } from "../line/helper.ts";
import { processKindleBooks, summaryDocumentState } from "./kindle.ts";

test("summaryDocumentState は0件または1件のドキュメントを受け付ける", () => {
  expect(summaryDocumentState([])).toEqual({ action: "create" });
  expect(summaryDocumentState([{ id: "doc-1" }])).toEqual({
    action: "append",
    documentId: "doc-1",
  });
  expect(summaryDocumentState([{ id: "a" }, { id: "b" }]).action).toBe("error");
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
  expect(text).toMatch(/Kindle要約完了/);
  expect(text).toMatch(/処理: 2枚/);
  expect(text).toMatch(/kindle_book/);
  expect(text).toMatch(/craftdocs:\/\/open\?/);
});

test("processKindleBooks はCraftのないフォルダをスキップし1ドキュメントに追記する", async () => {
  const moves: Array<Parameters<Parameters<typeof processKindleBooks>[0]["moveImageToProcessed"]>[0]> = [];
  const appends: Array<{ documentId: string; markdown: string }> = [];
  const creates: Array<{ folderId: string; markdown: string }> = [];
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

  expect(summary.foldersSkippedNoCraft).toBe(1);
  expect(summary.imagesSummarized).toBe(1);
  expect(creates.length).toBe(0);
  expect(appends).toEqual([{ documentId: "doc-1", markdown: "要約本文" }]);
  expect(moves.length).toBe(1);
  expect(summary.links).toEqual([{ folderName: "kindle_book", documentId: "doc-1" }]);
});

test("processKindleBooks はCraftフォルダが空のとき要約ドキュメントを作成する", async () => {
  const creates: Array<{ folderId: string; markdown: string }> = [];
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

  expect(summary.imagesSummarized).toBe(1);
  expect(creates).toEqual([{ folderId: "craft-folder", markdown: "初回要約" }]);
  expect(summary.links).toEqual([{ folderName: "kindle_book", documentId: "doc-new" }]);
});
