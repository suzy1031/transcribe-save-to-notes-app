import { expect, test } from "vitest";
import { kindleRunSummaryMessage } from "../line/helper.ts";
import { obsidianAppNoteLink } from "../obsidian/helper.ts";
import { processKindleBooks } from "./kindle.ts";

test("kindleRunSummaryMessage にフォルダ名とObsidianリンクが列挙される", () => {
  const text = kindleRunSummaryMessage({
    summarized: 2,
    failed: 0,
    links: [
      {
        folderName: "kindle_book",
        appLink: obsidianAppNoteLink("ks-vault", "kindle/kindle_book.md"),
      },
    ],
  });
  expect(text).toMatch(/Kindle要約完了/);
  expect(text).toMatch(/処理: 2枚/);
  expect(text).toMatch(/kindle_book/);
  expect(text).toMatch(/obsidian:\/\/open\?/);
});

test("processKindleBooks は各書籍フォルダの画像を要約してS3ノートへ保存・追記し画像を移動する", async () => {
  const moves: Array<Parameters<Parameters<typeof processKindleBooks>[0]["moveImageToProcessed"]>[0]> = [];
  const saved: Array<{ bookTitle: string; markdown: string }> = [];
  const bookFolders = [
    { id: "drive-1", name: "kindle_empty" },
    { id: "drive-2", name: "kindle_book" },
  ];

  const summary = await processKindleBooks({
    bookFolders,
    listImages: async (folderId) => {
      if (folderId === "drive-2") {
        return [
          { id: "img-1", name: "page1.png", mimeType: "image/png" },
          { id: "img-2", name: "page2.png", mimeType: "image/png" },
        ];
      }
      return [];
    },
    download: async () => Buffer.from("image"),
    saveOrAppendBookNote: async (input) => {
      saved.push(input);
      return `kindle/${input.bookTitle}.md`;
    },
    summarizeImage: async () => "要約本文",
    ensureProcessedFolder: async () => "processed-1",
    moveImageToProcessed: async (input) => {
      moves.push(input);
    },
  });

  expect(summary.imagesSummarized).toBe(2);
  expect(saved).toEqual([
    { bookTitle: "kindle_book", markdown: "要約本文" },
    { bookTitle: "kindle_book", markdown: "要約本文" },
  ]);
  expect(moves.length).toBe(2);
  expect(summary.links).toEqual([{ folderName: "kindle_book", documentId: "kindle/kindle_book.md" }]);
});
