import { expect, test } from "vitest";
import { craftAppDocumentLink } from "../craft/helper.ts";
import {
  fitLineText,
  LINE_TEXT_LIMIT,
  reminderDeliveredMessage,
  reminderFailedMessage,
  transcriptionFailedMessage,
  transcriptionSavedMessage,
} from "./helper.ts";
import { createLineClient, LINE_PUSH_URL } from "./line.ts";

test("fitLineText は短いメッセージをそのまま返し5000文字で切り詰める", () => {
  expect(fitLineText("こんにちは")).toBe("こんにちは");
  const long = "あ".repeat(LINE_TEXT_LIMIT + 25);
  expect(fitLineText(long).length).toBe(LINE_TEXT_LIMIT);
  expect(fitLineText(long)).toBe("あ".repeat(LINE_TEXT_LIMIT));
});

test("文字起こし用LINEメッセージに保存タイトルと失敗ファイル名が含まれる", () => {
  const link = craftAppDocumentLink("space-1", "doc-1");
  expect(transcriptionSavedMessage("2026/11/02", link)).toBe(`2026/11/02\n${link}`);
  expect(transcriptionSavedMessage("2026/11/02", "")).toBe("2026/11/02");
  expect(reminderDeliveredMessage("週次まとめ 2026-11-01", link)).toBe(
    `【リマインダー】\n週次まとめ 2026-11-01\n${link}`,
  );
  expect(transcriptionFailedMessage("note.png", "model failed")).toBe(
    "文字起こしに失敗しました\nnote.png\nmodel failed",
  );
  expect(reminderFailedMessage("Craft folder was not found")).toBe(
    "週次リマインドに失敗しました\nCraft folder was not found",
  );
});

test("push はチャンネルトークンでテキストメッセージを1件送る", async () => {
  const calls: Array<{ url: string; authorization: string; body: unknown }> = [];
  const fetchImpl: typeof fetch = async (url, options) => {
    calls.push({
      url: String(url),
      authorization: new Headers(options?.headers).get("authorization") ?? "",
      body: JSON.parse(String(options?.body ?? "")),
    });
    return new Response("{}", { status: 200 });
  };
  const line = createLineClient({
    channelAccessToken: "channel-token",
    userId: "U123",
    fetchImpl,
  });
  await line.push("週次まとめ");
  expect(calls[0].url).toBe(LINE_PUSH_URL);
  expect(calls[0].authorization).toBe("Bearer channel-token");
  expect(calls[0].body).toEqual({
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
  await expect(line.push("週次まとめ")).rejects.toThrow(/LINE push failed: 401/);
});
