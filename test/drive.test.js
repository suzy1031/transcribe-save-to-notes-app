import assert from "node:assert/strict";
import test from "node:test";
import { isSupportedImage, filterKindleBookFolders, orphanTextFiles, resolveUniqueFolder } from "../lambda/drive.js";

const folder = (id, name) => ({
  id,
  name,
  mimeType: "application/vnd.google-apps.folder",
});

test("isSupportedImage はpng・jpg・jpegを受け付ける", () => {
  assert.equal(isSupportedImage({ name: "note.png", mimeType: "image/png" }), true);
  assert.equal(isSupportedImage({ name: "note.jpg", mimeType: "image/jpeg" }), true);
  assert.equal(isSupportedImage({ name: "note.JPEG", mimeType: "image/jpeg" }), true);
});

test("isSupportedImage はmimeがimageでも他形式を拒否する", () => {
  assert.equal(isSupportedImage({ name: "note.pdf", mimeType: "application/pdf" }), false);
  assert.equal(isSupportedImage({ name: "note.heic", mimeType: "image/heic" }), false);
  assert.equal(isSupportedImage({ name: "note.heic", mimeType: "image/jpeg" }), false);
  assert.equal(isSupportedImage({ name: "note.txt", mimeType: "text/plain" }), false);
});

test("orphanTextFiles は画像が残る間は対応txtを残す", () => {
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

test("resolveUniqueFolder はフォルダ名がちょうど1件であることを要求する", () => {
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

test("filterKindleBookFolders は名前がkindle_で始まるフォルダのみ残す", () => {
  const folders = [
    folder("a", "kindle_book_one"),
    folder("b", "processed"),
    folder("c", "other_kindle"),
    { id: "d", name: "kindle_two", mimeType: "image/png" },
  ];
  assert.deepEqual(
    filterKindleBookFolders(folders).map((item) => item.id),
    ["a"],
  );
});
