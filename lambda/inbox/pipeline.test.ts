import { expect, test } from "vitest";
import type { DriveClient, DriveFile } from "../drive/types.ts";
import { settingsFromEnv } from "../shared/settings.ts";
import { runInboxWithMcp } from "./index.ts";

const image: DriveFile = {
  id: "file-1",
  name: "note.png",
  mimeType: "image/png",
};

const baseSettings = settingsFromEnv({
  CLAUDE_MODEL_ID: "claude-sonnet-5-5",
  OBSIDIAN_DAILY_FOLDER: "00_daily_notes",
});

const baseCredentials = {
  anthropicApiKey: "sk-ant-test",
  lineChannelAccessToken: "",
  lineUserId: "",
  mcpAuthToken: "mcp-inbox-token",
};

function makeFakeDrive({
  files = [image],
  inboxOk = true,
  processedOk = true,
  bytes = Buffer.from("png-bytes"),
}: {
  files?: DriveFile[];
  inboxOk?: boolean;
  processedOk?: boolean;
  bytes?: Buffer;
} = {}): DriveClient {
  return {
    async findUniqueFolder(name: string) {
      if (name === "00_notes_inbox") return inboxOk ? { ok: true, id: "inbox-1" } : { ok: false, count: 0 };
      return processedOk ? { ok: true, id: "processed-1" } : { ok: false, count: 0 };
    },
    async listImages() {
      return files;
    },
    async download() {
      return bytes;
    },
  } as unknown as DriveClient;
}

test("runInboxWithMcp は画像がないとき Claude API を呼ばず終了する", async () => {
  let called = 0;
  const summary = await runInboxWithMcp({
    context: { getRemainingTimeInMillis: () => 300_000 },
    settings: baseSettings,
    credentials: baseCredentials,
    drive: makeFakeDrive({ files: [] }),
    fetchImpl: async () => {
      called += 1;
      return new Response("{}");
    },
  });

  expect(summary).toEqual({ processed: 0, failed: 0, skipped: 0, deferred: 0 });
  expect(called).toBe(0);
});

test("runInboxWithMcp はフォルダ解決失敗時に folderLookup failed を返す", async () => {
  const summary = await runInboxWithMcp({
    context: { getRemainingTimeInMillis: () => 300_000 },
    settings: baseSettings,
    credentials: baseCredentials,
    drive: makeFakeDrive({ inboxOk: false }),
  });

  expect(summary).toEqual({ processed: 0, failed: 0, skipped: 0, deferred: 0, folderLookup: "failed" });
});

test("runInboxWithMcp は obsidian / drive / line の mcp_servers を指定して画像を処理する", async () => {
  const requests: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  const summary = await runInboxWithMcp({
    context: { getRemainingTimeInMillis: () => 300_000 },
    settings: baseSettings,
    credentials: baseCredentials,
    drive: makeFakeDrive(),
    fetchImpl: async (_url, options) => {
      requests.push({
        headers: new Headers(options?.headers),
        body: JSON.parse(String(options?.body ?? "{}")),
      });
      return new Response(
        JSON.stringify({
          model: "claude-sonnet-5-5",
          usage: { input_tokens: 50, output_tokens: 20 },
          content: [{ type: "text", text: "完了" }],
        }),
        { status: 200 },
      );
    },
    recordUsage: async () => {},
  });

  expect(summary).toEqual({ processed: 1, failed: 0, skipped: 0, deferred: 0 });
  expect(requests).toHaveLength(1);
  expect(requests[0].headers.get("anthropic-beta")).toBe("mcp-client-2025-11-20");
  expect(requests[0].body.mcp_servers).toEqual([
    {
      type: "url",
      url: "https://obsidian.infra-practice.jp/",
      name: "obsidian-s3",
      authorization_token: "mcp-inbox-token",
    },
    {
      type: "url",
      url: "https://drive.infra-practice.jp/",
      name: "google-drive",
      authorization_token: "mcp-inbox-token",
    },
    {
      type: "url",
      url: "https://line.infra-practice.jp/",
      name: "line-notification",
      authorization_token: "mcp-inbox-token",
    },
  ]);
});

test("runInboxWithMcp はサイズ上限超過の画像をスキップする", async () => {
  let called = 0;
  const summary = await runInboxWithMcp({
    context: { getRemainingTimeInMillis: () => 300_000 },
    settings: baseSettings,
    credentials: baseCredentials,
    drive: makeFakeDrive({ files: [{ ...image, size: "100" }] }),
    maxImageBytes: 50,
    fetchImpl: async () => {
      called += 1;
      return new Response("{}");
    },
  });

  expect(summary).toEqual({ processed: 0, failed: 0, skipped: 1, deferred: 0 });
  expect(called).toBe(0);
});

test("runInboxWithMcp は残り時間不足のとき残件を deferred にして中断する", async () => {
  const summary = await runInboxWithMcp({
    context: { getRemainingTimeInMillis: () => 59_000 },
    settings: baseSettings,
    credentials: baseCredentials,
    drive: makeFakeDrive({ files: [image, { ...image, id: "file-2", name: "note2.png" }] }),
  });

  expect(summary).toEqual({ processed: 0, failed: 0, skipped: 0, deferred: 2 });
});

test("runInboxWithMcp は Claude API 失敗時に failed をカウントする", async () => {
  const summary = await runInboxWithMcp({
    context: { getRemainingTimeInMillis: () => 300_000 },
    settings: baseSettings,
    credentials: baseCredentials,
    drive: makeFakeDrive(),
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 }),
  });

  expect(summary).toEqual({ processed: 0, failed: 1, skipped: 0, deferred: 0 });
});
