import { expect, test } from "vitest";
import { createDriveClient } from "./drive.ts";
import {
  escapeDriveQuery,
  filterKindleBookFolders,
  isSupportedImage,
  orphanTextFiles,
  resolveUniqueFolder,
} from "./helper.ts";

const folder = (id: string, name: string) => ({
  id,
  name,
  mimeType: "application/vnd.google-apps.folder",
});

test("isSupportedImage はpng・jpg・jpegを受け付ける", () => {
  expect(isSupportedImage({ name: "note.png", mimeType: "image/png" })).toBe(true);
  expect(isSupportedImage({ name: "note.jpg", mimeType: "image/jpeg" })).toBe(true);
  expect(isSupportedImage({ name: "note.JPEG", mimeType: "image/jpeg" })).toBe(true);
});

test("isSupportedImage はmimeがimageでも他形式を拒否する", () => {
  expect(isSupportedImage({ name: "note.pdf", mimeType: "application/pdf" })).toBe(false);
  expect(isSupportedImage({ name: "note.heic", mimeType: "image/heic" })).toBe(false);
  expect(isSupportedImage({ name: "note.heic", mimeType: "image/jpeg" })).toBe(false);
  expect(isSupportedImage({ name: "note.txt", mimeType: "text/plain" })).toBe(false);
});

test("orphanTextFiles は画像が残る間は対応txtを残す", () => {
  const texts = [
    { id: "t1", name: "2026.10.30.txt" },
    { id: "t2", name: "note.TXT" },
  ];
  const remaining = [{ id: "i1", name: "2026.10.30.png" }];
  expect(orphanTextFiles(texts, remaining).map((file) => file.name)).toEqual(["note.TXT"]);
});

test("resolveUniqueFolder はフォルダ名がちょうど1件であることを要求する", () => {
  expect(resolveUniqueFolder([], "00_notes_inbox").ok).toBe(false);
  expect(resolveUniqueFolder([folder("a", "00_notes_inbox")], "00_notes_inbox")).toEqual({ ok: true, id: "a" });
  expect(resolveUniqueFolder([folder("a", "00_notes_inbox"), folder("b", "00_notes_inbox")], "00_notes_inbox").ok).toBe(
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
  expect(filterKindleBookFolders(folders).map((item) => item.id)).toEqual(["a"]);
});

test("escapeDriveQuery はバックスラッシュとシングルクォートを正しくエスケープする", () => {
  expect(escapeDriveQuery("normal_folder")).toBe("normal_folder");
  expect(escapeDriveQuery("folder's")).toBe("folder\\'s");
  expect(escapeDriveQuery("folder\\name")).toBe("folder\\\\name");
  // クエリインジェクション対策: \' を含む文字列でバックスラッシュが先にエスケープされること
  expect(escapeDriveQuery("test\\' or name = 'inbox")).toBe("test\\\\\\' or name = \\'inbox");
  expect(escapeDriveQuery("\\' or 1=1 --")).toBe("\\\\\\' or 1=1 --");
  expect(escapeDriveQuery(12345 as unknown as string)).toBe("12345");
});

test("findUniqueFolder はエスケープされた検索クエリを生成する", async () => {
  const requests: string[] = [];
  const fetchImpl: typeof fetch = async (url) => {
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
  expect(res).toEqual({ ok: true, id: "folder-1" });
  expect(requests.length).toBe(1);
  const parsedUrl = new URL(requests[0]);
  expect(parsedUrl.searchParams.get("q")).toBe(
    "name = 'it\\\\\\'s\\\\folder' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
  );
});

test("ensureChildFolder はエスケープされた検索クエリでフォルダを検索・作成する", async () => {
  const requests: Array<{ url: string; options?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, options) => {
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
  expect(id).toBe("new-folder-id");
  expect(requests.length).toBe(2);

  const searchUrl = new URL(requests[0].url);
  expect(searchUrl.searchParams.get("q")).toBe(
    "'parent-1' in parents and name = 'user\\'s\\\\folder' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
  );

  const postBody = JSON.parse(String(requests[1].options?.body ?? ""));
  expect(postBody.name).toBe("user's\\folder");
  expect(postBody.parents).toEqual(["parent-1"]);
});
