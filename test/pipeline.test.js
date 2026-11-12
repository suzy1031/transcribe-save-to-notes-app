import assert from "node:assert/strict";
import test from "node:test";
import { processInbox } from "../lambda/index.ts";
import { MAX_IMAGE_BYTES } from "../lambda/transcribe/index.ts";

const image = {
  id: "file-1",
  name: "note.png",
  mimeType: "image/png",
};

function pipeline(overrides) {
  const calls = { download: 0, transcribe: 0, create: [], move: [], removed: [], saved: [], failed: [] };
  const deps = {
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
  assert.deepEqual(saved.calls.saved, [{ title: "朝のメモ", documentId: "doc-1" }]);
  assert.equal(saved.calls.failed.length, 0);

  const empty = pipeline({ files: [] });
  await empty.run();
  assert.equal(empty.calls.saved.length, 0);
  assert.equal(empty.calls.failed.length, 0);
});

test("文字起こし失敗時はLINE通知し画像を受信箱に残す", async () => {
  const { calls, run } = pipeline({
    transcribe: async () => {
      throw new Error("model failed");
    },
  });
  const summary = await run();
  assert.equal(summary.failed, 1);
  assert.equal(calls.move.length, 0);
  assert.deepEqual(calls.failed, [{ fileName: "note.png", reason: "model failed" }]);
  assert.equal(calls.saved.length, 0);
});

test("既存のcraftDocumentIdがある場合は新規作成せず移動する", async () => {
  const { calls, run } = pipeline({
    files: [{ ...image, appProperties: { craftDocumentId: "doc-existing" } }],
    download: async () => {
      throw new Error("should not download");
    },
  });
  const summary = await run();
  assert.equal(summary.processed, 1);
  assert.equal(calls.create.length, 0);
  assert.equal(calls.move[0].craftDocumentId, "doc-existing");
});

test("新規ノートは解決したCraftフォルダに作成してから移動する", async () => {
  const { calls, run } = pipeline();
  const summary = await run();
  assert.equal(summary.processed, 1);
  assert.equal(calls.create[0].folderId, "folder-daily");
  assert.equal(calls.move[0].craftDocumentId, "doc-1");
});

test("サイズ超過の画像は受信箱に残す", async () => {
  const { calls, run } = pipeline({
    files: [{ ...image, size: String(MAX_IMAGE_BYTES + 1) }],
    download: async () => {
      throw new Error("should not download");
    },
  });
  const summary = await run();
  assert.equal(summary.skipped, 1);
  assert.equal(calls.download, 0);
  assert.equal(calls.move.length, 0);
  assert.equal(calls.create.length, 0);
});

test("一覧にサイズが無い場合はダウンロード後にサイズ超過を判定する", async () => {
  const { calls, run } = pipeline({
    download: async () => {
      calls.download += 1;
      return Buffer.alloc(MAX_IMAGE_BYTES + 1);
    },
  });
  const summary = await run();
  assert.equal(summary.skipped, 1);
  assert.equal(calls.download, 1);
  assert.equal(calls.move.length, 0);
  assert.equal(calls.create.length, 0);
});

test("processInbox は取得・文字起こし・Craft保存をログに記録する", async () => {
  const lines = [];
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
  assert.deepEqual(lines, [
    "画像ファイル取得成功 note.png",
    "文字起こし start note.png",
    "文字起こし end note.png",
    "craft保存 start note.png",
    "craft保存 end note.png",
  ]);
});

test("受信箱が空の場合は画像なしをログに記録する", async () => {
  const lines = [];
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
  assert.deepEqual(lines, ["画像ファイル取得なし"]);
  assert.equal(summary.processed, 0);
  assert.equal(calls.create.length, 0);
});

test("移動した画像は付随テキストを削除する", async () => {
  const { calls, run } = pipeline();
  await run();
  assert.deepEqual(calls.removed, ["note.png"]);
});

test("文字起こし失敗時は付随テキストを残す", async () => {
  const { calls, run } = pipeline({
    transcribe: async () => {
      throw new Error("model failed");
    },
  });
  await run();
  assert.equal(calls.removed.length, 0);
});

test("Craft作成失敗時は画像を移動しない", async () => {
  const { calls, run } = pipeline({
    createDocument: async () => {
      throw new Error("craft failed");
    },
  });
  const summary = await run();
  assert.equal(summary.failed, 1);
  assert.equal(calls.move.length, 0);
});
