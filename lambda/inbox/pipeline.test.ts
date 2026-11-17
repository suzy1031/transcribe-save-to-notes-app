import { expect, test } from "vitest";
import { MAX_IMAGE_BYTES } from "../transcribe/index.ts";
import { processInbox } from "./index.ts";

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
    create: Array<{ title: string; markdown: string; folderId: string }>;
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
    ensureFolder: async () => "folder-daily",
    createDocument: async (input) => {
      calls.create.push(input);
      return "doc-1";
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
  expect(saved.calls.saved).toEqual([{ title: "朝のメモ", documentId: "doc-1" }]);
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

test("新規ノートは解決したCraftフォルダに作成してから移動する", async () => {
  const { calls, run } = pipeline();
  const summary = await run();
  expect(summary.processed).toBe(1);
  expect(calls.create[0].folderId).toBe("folder-daily");
  expect(calls.move[0].craftDocumentId).toBe("doc-1");
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

test("processInbox は取得・文字起こし・Craft保存をログに記録する", async () => {
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
    "craft保存 start note.png",
    "craft保存 end note.png",
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

test("Craft作成失敗時は画像を移動しない", async () => {
  const { calls, run } = pipeline({
    createDocument: async () => {
      throw new Error("craft failed");
    },
  });
  const summary = await run();
  expect(summary.failed).toBe(1);
  expect(calls.move.length).toBe(0);
});
