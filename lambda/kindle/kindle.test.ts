import { expect, test } from "vitest";
import type { DriveClient } from "../../interfaces/drive.ts";
import { kindleRunSummaryMessage } from "../../shared/line/helper.ts";
import { obsidianAppNoteLink } from "../../shared/obsidian/helper.ts";
import { kindleSettingsFromEnv, runKindleWithMcp } from "./kindle.ts";

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

test("runKindleWithMcp は obsidian / drive / line の mcp_servers を指定して画像を処理する", async () => {
  const requests: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  const fakeDrive = {
    async findUniqueFolder() {
      return { ok: true as const, id: "kindle-parent" };
    },
    async listKindleBookFolders() {
      return [{ id: "book-1", name: "kindle_book" }];
    },
    async listImages() {
      return [{ id: "img-1", name: "page1.png", mimeType: "image/png" }];
    },
    async ensureChildFolder() {
      return "processed-1";
    },
    async download() {
      return Buffer.from("png-bytes");
    },
  } as unknown as DriveClient;

  const result = await runKindleWithMcp({
    context: { getRemainingTimeInMillis: () => 300_000 },
    settings: kindleSettingsFromEnv({}),
    credentials: {
      anthropicApiKey: "sk-ant-test",
      lineChannelAccessToken: "",
      lineUserId: "",
      mcpAuthToken: "mcp-kindle-token",
    },
    drive: fakeDrive,
    fetchImpl: async (_url, options) => {
      requests.push({
        headers: new Headers(options?.headers),
        body: JSON.parse(String(options?.body ?? "{}")),
      });
      return new Response(
        JSON.stringify({
          model: "claude-sonnet-5-5",
          usage: { input_tokens: 40, output_tokens: 20 },
          content: [{ type: "text", text: "Kindle要約完了" }],
        }),
        { status: 200 },
      );
    },
    recordUsage: async () => {},
  });

  expect(result.foldersScanned).toBe(1);
  expect(result.imagesSummarized).toBe(1);
  expect(result.imagesFailed).toBe(0);
  expect(requests).toHaveLength(1);
  expect(requests[0].headers.get("anthropic-beta")).toBe("mcp-client-2025-11-20");
  expect(requests[0].body.mcp_servers).toEqual([
    {
      type: "url",
      url: "https://obsidian.infra-practice.jp/",
      name: "obsidian-s3",
      authorization_token: "mcp-kindle-token",
    },
    {
      type: "url",
      url: "https://drive.infra-practice.jp/",
      name: "google-drive",
      authorization_token: "mcp-kindle-token",
    },
    {
      type: "url",
      url: "https://line.infra-practice.jp/",
      name: "line-notification",
      authorization_token: "mcp-kindle-token",
    },
  ]);
});
