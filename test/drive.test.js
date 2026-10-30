import assert from "node:assert/strict";
import test from "node:test";
import { isSupportedImage, orphanTextFiles, resolveUniqueFolder } from "../lambda/drive.js";

const folder = (id, name) => ({
  id,
  name,
  mimeType: "application/vnd.google-apps.folder",
});

test("isSupportedImage accepts png, jpg, and jpeg", () => {
  assert.equal(isSupportedImage({ name: "note.png", mimeType: "image/png" }), true);
  assert.equal(isSupportedImage({ name: "note.jpg", mimeType: "image/jpeg" }), true);
  assert.equal(isSupportedImage({ name: "note.JPEG", mimeType: "image/jpeg" }), true);
});

test("isSupportedImage rejects other types even when the mime type is an image", () => {
  assert.equal(isSupportedImage({ name: "note.pdf", mimeType: "application/pdf" }), false);
  assert.equal(isSupportedImage({ name: "note.heic", mimeType: "image/heic" }), false);
  assert.equal(isSupportedImage({ name: "note.heic", mimeType: "image/jpeg" }), false);
  assert.equal(isSupportedImage({ name: "note.txt", mimeType: "text/plain" }), false);
});

test("orphanTextFiles keeps a txt while its image remains", () => {
  const texts = [
    { id: "t1", name: "2026.10.30.txt" },
    { id: "t2", name: "note.TXT" },
  ];
  const remaining = [{ id: "i1", name: "2026.10.30.png" }];
  assert.deepEqual(
    orphanTextFiles(texts, remaining).map((file) => file.name),
    ["note.TXT"],
  );
});

test("resolveUniqueFolder requires exactly one folder name", () => {
  assert.equal(resolveUniqueFolder([], "00_notes_inbox").ok, false);
  assert.deepEqual(
    resolveUniqueFolder([folder("a", "00_notes_inbox")], "00_notes_inbox"),
    { ok: true, id: "a" },
  );
  assert.equal(
    resolveUniqueFolder(
      [folder("a", "00_notes_inbox"), folder("b", "00_notes_inbox")],
      "00_notes_inbox",
    ).ok,
    false,
  );
});
