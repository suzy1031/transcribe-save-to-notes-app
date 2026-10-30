import assert from "node:assert/strict";
import test from "node:test";
import { processInbox } from "../lambda/index.js";
import { MAX_IMAGE_BYTES } from "../lambda/transcribe/index.js";

const image = {
  id: "file-1",
  name: "note.png",
  mimeType: "image/png",
};

function pipeline(overrides) {
  const calls = { download: 0, transcribe: 0, create: [], move: [], removed: [] };
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
    getRemainingTimeMs: () => 120_000,
    log: { info() {}, error() {} },
    ...overrides,
  };
  return { calls, run: () => processInbox(deps) };
}

test("a transcription failure leaves the image in the inbox", async () => {
  const { calls, run } = pipeline({
    transcribe: async () => {
      throw new Error("model failed");
    },
  });
  const summary = await run();
  assert.equal(summary.failed, 1);
  assert.equal(calls.move.length, 0);
});

test("an existing craftDocumentId is moved without creating another document", async () => {
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

test("a new note is created in the resolved Craft folder and then moved", async () => {
  const { calls, run } = pipeline();
  const summary = await run();
  assert.equal(summary.processed, 1);
  assert.equal(calls.create[0].folderId, "folder-daily");
  assert.equal(calls.move[0].craftDocumentId, "doc-1");
});

test("an oversized image stays in the inbox", async () => {
  const { calls, run } = pipeline({
    download: async () => Buffer.alloc(MAX_IMAGE_BYTES + 1),
  });
  const summary = await run();
  assert.equal(summary.skipped, 1);
  assert.equal(calls.move.length, 0);
  assert.equal(calls.create.length, 0);
});

test("processInbox logs fetch, transcription, and Craft save", async () => {
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

test("an empty inbox logs that no image was found", async () => {
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

test("a moved image removes its companion text", async () => {
  const { calls, run } = pipeline();
  await run();
  assert.deepEqual(calls.removed, ["note.png"]);
});

test("a transcription failure leaves the companion text", async () => {
  const { calls, run } = pipeline({
    transcribe: async () => {
      throw new Error("model failed");
    },
  });
  await run();
  assert.equal(calls.removed.length, 0);
});

test("a Craft create failure does not move the image", async () => {
  const { calls, run } = pipeline({
    createDocument: async () => {
      throw new Error("craft failed");
    },
  });
  const summary = await run();
  assert.equal(summary.failed, 1);
  assert.equal(calls.move.length, 0);
});
