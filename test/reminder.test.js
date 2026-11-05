import assert from "node:assert/strict";
import test from "node:test";
import { craftAppDocumentLink } from "../lambda/craft.js";
import { EMPTY_REMINDER_MESSAGE, reminderFailedMessage, transcriptionSavedMessage } from "../lambda/line.js";
import { notifyReminderLineError, processReminder, reminderTargetDate } from "../lambda/reminder.js";
import { tokyoDate } from "../lambda/weekly.js";

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
    transcriptionSavedMessage(
      "週次まとめ 2026-11-01",
      craftAppDocumentLink("space-1", "doc-1"),
    ),
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
