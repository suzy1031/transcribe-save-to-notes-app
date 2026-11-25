import { expect, test } from "vitest";
import type { DriveClient } from "../drive/types.ts";
import { settingsFromEnv } from "../shared/settings.ts";
import { MAX_IMAGE_BYTES } from "../transcribe/index.ts";
import { processInbox, runInboxWithMcp } from "./index.ts";

const image = {
  id: "file-1",
  name: "note.png",
  mimeType: "image/png",
};

type ProcessInboxArgs = Parameters<typeof processInbox>[0];

function pipeline(overrides: Partial<ProcessInboxArgs> = {}) {
  const calls: {
    download: number;
    transcribe: number;
    create: Array<{ title: string; markdown: string }>;
    move: Array<Parameters<ProcessInboxArgs["moveToProcessed"]>[0]>;
    removed: string[];
    saved: Array<{ title: string; documentId: string }>;
    failed: Array<{ fileName: string; reason: string }>;
  } = { download: 0, transcribe: 0, create: [], move: [], removed: [], saved: [], failed: [] };
  const deps: ProcessInboxArgs = {
    files: [image],
    download: async () => {
      calls.download += 1;
      return Buffer.from("png");
    },
    transcribe: async () => {
      calls.transcribe += 1;
      return { title: "朝のメモ", markdown: "本文" };
    },
    saveNote: async (input) => {
      calls.create.push(input);
      return "00_daily_notes/朝のメモ.md";
    },
    moveToProcessed: async (input) => {
      calls.move.push(input);
    },
    removeTextFiles: async (file) => {
      calls.removed.push(file.name);
    },
    notifySaved: async (input) => {
      calls.saved.push(input);
    },
    notifyFailed: async (input) => {
      calls.failed.push(input);
    },
    getRemainingTimeMs: () => 120_000,
    log: { info() {}, error() {} },
    ...overrides,
  };
  return { calls, run: () => processInbox(deps) };
}

test("保存成功時はLINE通知し、受信箱が空の場合は通知しない", async () => {
  const saved = pipeline();
  await saved.run();
  expect(saved.calls.saved).toEqual([{ title: "朝のメモ", documentId: "00_daily_notes/朝のメモ.md" }]);
  expect(saved.calls.failed.length).toBe(0);

  const empty = pipeline({ files: [] });
  await empty.run();
  expect(empty.calls.saved.length).toBe(0);
  expect(empty.calls.failed.length).toBe(0);
});

test("文字起こし失敗時はLINE通知し画像を受信箱に残す", async () => {
  const { calls, run } = pipeline({
    transcribe: async () => {
      throw new Error("model failed");
    },
  });
  const summary = await run();
  expect(summary.failed).toBe(1);
  expect(calls.move.length).toBe(0);
  expect(calls.failed).toEqual([{ fileName: "note.png", reason: "model failed" }]);
  expect(calls.saved.length).toBe(0);
});

test("既存のcraftDocumentIdがある場合は新規作成せず移動する", async () => {
  const { calls, run } = pipeline({
    files: [{ ...image, appProperties: { craftDocumentId: "doc-existing" } }],
    download: async () => {
      throw new Error("should not download");
    },
  });
  const summary = await run();
  expect(summary.processed).toBe(1);
  expect(calls.create.length).toBe(0);
  expect(calls.move[0].craftDocumentId).toBe("doc-existing");
});

test("新規ノートはObsidian(S3)に保存してから移動する", async () => {
  const { calls, run } = pipeline();
  const summary = await run();
  expect(summary.processed).toBe(1);
  expect(calls.create[0]).toEqual({ title: "朝のメモ", markdown: "本文" });
  expect(calls.move[0].craftDocumentId).toBe("00_daily_notes/朝のメモ.md");
});

test("サイズ超過の画像は受信箱に残す", async () => {
  const { calls, run } = pipeline({
    files: [{ ...image, size: String(MAX_IMAGE_BYTES + 1) }],
    download: async () => {
      throw new Error("should not download");
    },
  });
  const summary = await run();
  expect(summary.skipped).toBe(1);
  expect(calls.download).toBe(0);
  expect(calls.move.length).toBe(0);
  expect(calls.create.length).toBe(0);
});

test("一覧にサイズが無い場合はダウンロード後にサイズ超過を判定する", async () => {
  const { calls, run } = pipeline({
    download: async () => {
      calls.download += 1;
      return Buffer.alloc(MAX_IMAGE_BYTES + 1);
    },
  });
  const summary = await run();
  expect(summary.skipped).toBe(1);
  expect(calls.download).toBe(1);
  expect(calls.move.length).toBe(0);
  expect(calls.create.length).toBe(0);
});

test("processInbox は取得・文字起こし・Obsidian保存をログに記録する", async () => {
  const lines: unknown[] = [];
  const { run } = pipeline({
    log: {
      info(message) {
        lines.push(message);
      },
      error(message) {
        lines.push(message);
      },
    },
  });
  await run();
  expect(lines).toEqual([
    "画像ファイル取得成功 note.png",
    "文字起こし start note.png",
    "文字起こし end note.png",
    "obsidian保存 start note.png",
    "obsidian保存 end note.png",
  ]);
});

test("受信箱が空の場合は画像なしをログに記録する", async () => {
  const lines: unknown[] = [];
  const { calls, run } = pipeline({
    files: [],
    log: {
      info(message) {
        lines.push(message);
      },
      error() {},
    },
  });
  const summary = await run();
  expect(lines).toEqual(["画像ファイル取得なし"]);
  expect(summary.processed).toBe(0);
  expect(calls.create.length).toBe(0);
});

test("移動した画像は付随テキストを削除する", async () => {
  const { calls, run } = pipeline();
  await run();
  expect(calls.removed).toEqual(["note.png"]);
});

test("文字起こし失敗時は付随テキストを残す", async () => {
  const { calls, run } = pipeline({
    transcribe: async () => {
      throw new Error("model failed");
    },
  });
  await run();
  expect(calls.removed.length).toBe(0);
});

test("Obsidian保存失敗時は画像を移動しない", async () => {
  const { calls, run } = pipeline({
    saveNote: async () => {
      throw new Error("s3 failed");
    },
  });
  const summary = await run();
  expect(summary.failed).toBe(1);
  expect(calls.move.length).toBe(0);
});

test("runInboxWithMcp は obsidian / drive / line の mcp_servers を指定して画像を処理する", async () => {
  const requests: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  const fakeDrive = {
    async findUniqueFolder(name: string) {
      return { ok: true as const, id: name === "00_notes_inbox" ? "inbox-1" : "processed-1" };
    },
    async listImages() {
      return [image];
    },
    async download() {
      return Buffer.from("png-bytes");
    },
  } as unknown as DriveClient;

  const summary = await runInboxWithMcp({
    context: { getRemainingTimeInMillis: () => 300_000 },
    settings: settingsFromEnv({
      CLAUDE_MODEL_ID: "claude-sonnet-5-5",
      OBSIDIAN_DAILY_FOLDER: "00_daily_notes",
    }),
    credentials: {
      anthropicApiKey: "sk-ant-test",
      lineChannelAccessToken: "",
      lineUserId: "",
      mcpAuthToken: "mcp-inbox-token",
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
