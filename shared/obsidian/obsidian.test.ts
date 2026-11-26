import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { expect, test } from "vitest";
import {
  appendObsidianNoteContent,
  buildNoteKey,
  convertCraftHighlightsToObsidian,
  deriveNoteDateFromTitle,
  formatObsidianNote,
  obsidianAppNoteLink,
  sanitizeNoteFileName,
  stripFrontmatter,
} from "./helper.ts";
import { createObsidianClient } from "./obsidian.ts";

test("sanitizeNoteFileName と buildNoteKey はスラッシュをハイフンに置換して .md キーを作る", () => {
  expect(sanitizeNoteFileName("2026/11/19")).toBe("2026-11-19");
  expect(buildNoteKey("00_daily_notes", "2026/11/19")).toBe("00_daily_notes/2026-11-19.md");
  expect(buildNoteKey("/kindle/", "kindle_本の名前")).toBe("kindle/kindle_本の名前.md");
  expect(() => sanitizeNoteFileName("   ")).toThrow(/title is required/);
});

test("deriveNoteDateFromTitle はタイトルから YYYY-MM-DD を抽出する", () => {
  expect(deriveNoteDateFromTitle("2026/11/06")).toBe("2026-11-06");
  expect(deriveNoteDateFromTitle("週次まとめ 2026-11-1")).toBe("2026-11-01");
  expect(deriveNoteDateFromTitle("kindle_book")).toBeUndefined();
});

test("formatObsidianNote と stripFrontmatter は frontmatter の付与と除去を行う", () => {
  const note = formatObsidianNote({
    title: "2026/11/19",
    markdown: "## 仕事\n\n- タスク",
    tags: ["daily"],
  });
  expect(note).toBe(
    [
      "---",
      'title: "2026/11/19"',
      "date: 2026-11-19",
      "tags:",
      "  - daily",
      "---",
      "",
      "## 仕事",
      "",
      "- タスク",
      "",
    ].join("\n"),
  );
  expect(stripFrontmatter(note)).toBe("## 仕事\n\n- タスク");
});

test("convertCraftHighlightsToObsidian と appendObsidianNoteContent はハイライト変換と末尾追記を行う", () => {
  expect(convertCraftHighlightsToObsidian('<highlight color="red">重要な一文</highlight>')).toBe("==重要な一文==");
  const initial = formatObsidianNote({
    title: "kindle_book",
    markdown: "==最初の一文==\n\n- 補足1",
    tags: ["kindle"],
  });
  const appended = appendObsidianNoteContent(initial, '<highlight color="red">次のハイライト</highlight>\n\n- 補足2');
  expect(stripFrontmatter(appended)).toBe("==最初の一文==\n\n- 補足1\n\n==次のハイライト==\n\n- 補足2");
});

test("obsidianAppNoteLink は Vault 名とファイルパスから obsidian://open リンクを生成する", () => {
  expect(obsidianAppNoteLink("ks-vault", "00_daily_notes/2026-11-19.md")).toBe(
    "obsidian://open?vault=ks-vault&file=00_daily_notes%2F2026-11-19",
  );
  expect(obsidianAppNoteLink("", "00_daily_notes/2026-11-19.md")).toBe("");
});

test("createObsidianClient は saveOrAppendNote で新規作成と既存追記を切り替える", async () => {
  const objects = new Map<string, string>();
  const s3Client = {
    async send(command: unknown) {
      if (command instanceof GetObjectCommand) {
        const key = command.input.Key ?? "";
        const value = objects.get(key);
        if (value === undefined) {
          const err = new Error("Not found") as Error & { name: string };
          err.name = "NoSuchKey";
          throw err;
        }
        return {
          Body: {
            transformToString: async () => value,
          },
        };
      }
      if (command instanceof PutObjectCommand) {
        objects.set(command.input.Key ?? "", String(command.input.Body ?? ""));
        return {};
      }
      throw new Error("Unexpected command");
    },
  };

  const obsidian = createObsidianClient({ bucketName: "notes-bucket", s3Client });
  const key = await obsidian.saveOrAppendNote({
    folder: "00_daily_notes",
    title: "2026/11/19",
    markdown: "1ページ目",
    tags: ["daily"],
  });
  expect(key).toBe("00_daily_notes/2026-11-19.md");
  expect(await obsidian.readMarkdown(key)).toBe("1ページ目");

  await obsidian.saveOrAppendNote({
    folder: "00_daily_notes",
    title: "2026/11/19",
    markdown: "2ページ目",
    tags: ["daily"],
  });
  expect(await obsidian.readMarkdown(key)).toBe("1ページ目\n\n2ページ目");
});

test("createObsidianClient.listNotes はフォルダ内の .md を日付範囲で絞り込む", async () => {
  const s3Client = {
    async send(command: unknown) {
      if (command instanceof ListObjectsV2Command) {
        return {
          Contents: [
            { Key: "00_daily_notes/" },
            { Key: "00_daily_notes/2026-10-20.md", LastModified: new Date("2026-10-20T00:00:00Z") },
            { Key: "00_daily_notes/2026-10-26.md", LastModified: new Date("2026-10-26T00:00:00Z") },
            { Key: "00_daily_notes/2026-11-01.md", LastModified: new Date("2026-11-01T00:00:00Z") },
            { Key: "00_daily_notes/sub/nested.md", LastModified: new Date("2026-10-28T00:00:00Z") },
          ],
          IsTruncated: false,
        };
      }
      throw new Error("Unexpected command");
    },
  };

  const obsidian = createObsidianClient({ bucketName: "notes-bucket", s3Client });
  const notes = await obsidian.listNotes({
    folder: "00_daily_notes",
    createdDateGte: "2026-10-25",
    createdDateLte: "2026-11-01",
  });
  expect(notes.map((n) => n.key)).toEqual(["00_daily_notes/2026-10-26.md", "00_daily_notes/2026-11-01.md"]);
});
