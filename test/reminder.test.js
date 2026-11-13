import assert from "node:assert/strict";
import test from "node:test";
import { craftAppDocumentLink } from "../lambda/craft/craft.ts";
import { EMPTY_REMINDER_MESSAGE, reminderDeliveredMessage, reminderFailedMessage } from "../lambda/line/line.ts";
import {
  filterDocumentsByReminderTitle,
  listReminderDocuments,
  notifyReminderLineError,
  processReminder,
  reminderTargetDate,
  reminderTitleCandidates,
} from "../lambda/reminder/reminder.ts";
import { tokyoDate } from "../lambda/weekly/weekly.ts";

const sundayNov8 = new Date("2026-11-07T15:00:00Z");

function reminder(overrides) {
  const calls = { push: [] };
  const deps = {
    documents: [{ id: "doc-1", title: "週次まとめ 2026-11-01" }],
    pushLine: async (text) => {
      calls.push.push(text);
    },
    spaceId: "space-1",
    targetDate: "2026-11-01",
    ...overrides,
  };
  return { calls, run: () => processReminder(deps) };
}

test("reminderTargetDate は東京日付の7暦日前を返す", () => {
  assert.equal(tokyoDate(sundayNov8), "2026-11-08");
  assert.equal(reminderTargetDate(sundayNov8), "2026-11-01");
});

test("reminderTitleCandidates はゼロ埋めと非ゼロ埋め日付のタイトルを返す", () => {
  assert.deepEqual(reminderTitleCandidates("2026-11-01"), ["週次まとめ 2026-11-01", "週次まとめ 2026-11-1"]);
});

test("filterDocumentsByReminderTitle は対象日の週次まとめタイトルのみ残す", () => {
  const documents = [
    { id: "a", title: "週次まとめ 2026-11-01" },
    { id: "b", title: "週次まとめ 2026-11-08" },
    { id: "c", title: "メモ" },
  ];
  assert.deepEqual(filterDocumentsByReminderTitle(documents, "2026-11-01"), [
    { id: "a", title: "週次まとめ 2026-11-01" },
  ]);
});

test("listReminderDocuments は作成日0件のときタイトルでフォルダ内を探す", async () => {
  const calls = [];
  const craft = {
    listDocuments: async (query) => {
      calls.push(query);
      if (query.createdDateLte === "2026-11-01") return [];
      return [
        { id: "doc-1", title: "週次まとめ 2026-11-01" },
        { id: "doc-2", title: "週次まとめ 2026-10-25" },
      ];
    },
  };
  const result = await listReminderDocuments(craft, "folder-1", "2026-11-01");
  assert.equal(result.matchedBy, "title");
  assert.equal(result.documents.length, 1);
  assert.equal(result.documents[0].id, "doc-1");
  assert.equal(calls.length, 2);
});

test("一致するノートがない場合は固定のLINEメッセージを送る", async () => {
  const { calls, run } = reminder({ documents: [] });
  const result = await run();
  assert.deepEqual(result, { reminded: 0 });
  assert.deepEqual(calls.push, [EMPTY_REMINDER_MESSAGE]);
});

test("一致するノートが1件の場合はタイトルとCraftアプリリンクを送る", async () => {
  const { calls, run } = reminder();
  const result = await run();
  assert.deepEqual(result, { reminded: 1, documentId: "doc-1" });
  assert.deepEqual(calls.push, [
    reminderDeliveredMessage("週次まとめ 2026-11-01", craftAppDocumentLink("space-1", "doc-1")),
  ]);
});

test("一致するノートが複数の場合はLINEを送らず失敗する", async () => {
  const { calls, run } = reminder({
    documents: [
      { id: "doc-1", title: "a" },
      { id: "doc-2", title: "b" },
    ],
  });
  await assert.rejects(run, /expected exactly one/);
  assert.equal(calls.push.length, 0);
});

test("notifyReminderLineError は失敗メッセージをpushする", async () => {
  const calls = { push: [] };
  const line = {
    push: async (text) => {
      calls.push.push(text);
    },
  };
  await notifyReminderLineError({
    line,
    credentials: null,
    error: new Error("expected exactly one"),
  });
  assert.deepEqual(calls.push, [reminderFailedMessage("expected exactly one")]);
});

test("notifyReminderLineError はLINE認証情報がない場合にログを出す", async () => {
  const errors = [];
  const original = console.error;
  console.error = (message) => errors.push(message);
  try {
    await notifyReminderLineError({
      line: null,
      credentials: {},
      error: new Error("craft failed"),
    });
  } finally {
    console.error = original;
  }
  assert.equal(errors[0], "LINE通知失敗: credentials are missing");
});
