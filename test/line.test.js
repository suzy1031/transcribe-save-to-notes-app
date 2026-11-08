import assert from "node:assert/strict";
import test from "node:test";
import {
  createLineClient,
  fitLineText,
  LINE_PUSH_URL,
  LINE_TEXT_LIMIT,
  transcriptionFailedMessage,
  transcriptionSavedMessage,
  reminderDeliveredMessage,
  reminderFailedMessage,
} from "../lambda/line.js";
import { craftAppDocumentLink } from "../lambda/craft.js";

test("fitLineText は短いメッセージをそのまま返し5000文字で切り詰める", () => {
  assert.equal(fitLineText("こんにちは"), "こんにちは");
  const long = "あ".repeat(LINE_TEXT_LIMIT + 25);
  assert.equal(fitLineText(long).length, LINE_TEXT_LIMIT);
  assert.equal(fitLineText(long), "あ".repeat(LINE_TEXT_LIMIT));
});

test("文字起こし用LINEメッセージに保存タイトルと失敗ファイル名が含まれる", () => {
  const link = craftAppDocumentLink("space-1", "doc-1");
  assert.equal(transcriptionSavedMessage("2026/11/02", link), `2026/11/02\n${link}`);
  assert.equal(transcriptionSavedMessage("2026/11/02", ""), "2026/11/02");
  assert.equal(
    reminderDeliveredMessage("週次まとめ 2026-11-01", link),
    `【リマインダー】\n週次まとめ 2026-11-01\n${link}`,
  );
  assert.equal(
    transcriptionFailedMessage("note.png", "model failed"),
    "文字起こしに失敗しました\nnote.png\nmodel failed",
  );
  assert.equal(
    reminderFailedMessage("Craft folder was not found"),
    "週次リマインドに失敗しました\nCraft folder was not found",
  );
});

test("push はチャンネルトークンでテキストメッセージを1件送る", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({
      url,
      authorization: options.headers.authorization,
      body: JSON.parse(options.body),
    });
    return new Response("{}", { status: 200 });
  };
  const line = createLineClient({
    channelAccessToken: "channel-token",
    userId: "U123",
    fetchImpl,
  });
  await line.push("週次まとめ");
  assert.equal(calls[0].url, LINE_PUSH_URL);
  assert.equal(calls[0].authorization, "Bearer channel-token");
  assert.deepEqual(calls[0].body, {
    to: "U123",
    messages: [{ type: "text", text: "週次まとめ" }],
  });
});

test("LINEが拒否した場合pushは例外を投げる", async () => {
  const line = createLineClient({
    channelAccessToken: "channel-token",
    userId: "U123",
    fetchImpl: async () => new Response("invalid token", { status: 401 }),
  });
  await assert.rejects(() => line.push("週次まとめ"), /LINE push failed: 401/);
});
