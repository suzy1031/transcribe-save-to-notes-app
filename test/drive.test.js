import assert from "node:assert/strict";
import test from "node:test";
import {
  createDriveClient,
  escapeDriveQuery,
  filterKindleBookFolders,
  isSupportedImage,
  orphanTextFiles,
  resolveUniqueFolder,
} from "../lambda/drive.ts";

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
  assert.deepEqual(resolveUniqueFolder([folder("a", "00_notes_inbox")], "00_notes_inbox"), { ok: true, id: "a" });
  assert.equal(
    resolveUniqueFolder([folder("a", "00_notes_inbox"), folder("b", "00_notes_inbox")], "00_notes_inbox").ok,
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

test("escapeDriveQuery はバックスラッシュとシングルクォートを正しくエスケープする", () => {
  assert.equal(escapeDriveQuery("normal_folder"), "normal_folder");
  assert.equal(escapeDriveQuery("folder's"), "folder\\'s");
  assert.equal(escapeDriveQuery("folder\\name"), "folder\\\\name");
  // クエリインジェクション対策: \' を含む文字列でバックスラッシュが先にエスケープされること
  assert.equal(escapeDriveQuery("test\\' or name = 'inbox"), "test\\\\\\' or name = \\'inbox");
  assert.equal(escapeDriveQuery("\\' or 1=1 --"), "\\\\\\' or 1=1 --");
  assert.equal(escapeDriveQuery(12345), "12345");
});

test("findUniqueFolder はエスケープされた検索クエリを生成する", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url.toString());
    return new Response(
      JSON.stringify({
        files: [folder("folder-1", "it\\'s\\folder")],
      }),
      { status: 200 },
    );
  };
  const drive = createDriveClient({
    authClient: { getAccessToken: async () => "mock-token" },
    fetchImpl,
  });

  const res = await drive.findUniqueFolder("it\\'s\\folder");
  assert.equal(res.ok, true);
  assert.equal(res.id, "folder-1");
  assert.equal(requests.length, 1);
  const parsedUrl = new URL(requests[0]);
  assert.equal(
    parsedUrl.searchParams.get("q"),
    "name = 'it\\\\\\'s\\\\folder' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
  );
});

test("ensureChildFolder はエスケープされた検索クエリでフォルダを検索・作成する", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: url.toString(), options });
    if (options?.method === "POST") {
      return new Response(JSON.stringify({ id: "new-folder-id" }), { status: 200 });
    }
    return new Response(JSON.stringify({ files: [] }), { status: 200 });
  };
  const drive = createDriveClient({
    authClient: { getAccessToken: async () => "mock-token" },
    fetchImpl,
  });

  const id = await drive.ensureChildFolder("parent-1", "user's\\folder");
  assert.equal(id, "new-folder-id");
  assert.equal(requests.length, 2);

  const searchUrl = new URL(requests[0].url);
  assert.equal(
    searchUrl.searchParams.get("q"),
    "'parent-1' in parents and name = 'user\\'s\\\\folder' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
  );

  const postBody = JSON.parse(requests[1].options.body);
  assert.equal(postBody.name, "user's\\folder");
  assert.deepEqual(postBody.parents, ["parent-1"]);
});
