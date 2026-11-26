import { expect, test } from "vitest";
import { tokyoDate } from "../shared/tokyo-date.ts";
import {
  filterDocumentsByReminderTitle,
  reminderSettingsFromEnv,
  reminderTargetDate,
  reminderTitleCandidates,
  runReminderWithMcp,
} from "./reminder.ts";

const sundayNov8 = new Date("2026-11-07T15:00:00Z");

test("reminderTargetDate は実行日から7日前の東京日付を返す", () => {
  expect(tokyoDate(sundayNov8)).toBe("2026-11-08");
  expect(reminderTargetDate(sundayNov8)).toBe("2026-11-01");
});

test("reminderTitleCandidates はゼロ埋めと非ゼロ埋めのタイトル候補を返す", () => {
  expect(reminderTitleCandidates("2026-11-01")).toEqual(["週次まとめ 2026-11-01", "週次まとめ 2026-11-1"]);
  expect(reminderTitleCandidates("2026-09-07")).toEqual(["週次まとめ 2026-09-07", "週次まとめ 2026-9-7"]);
});

test("filterDocumentsByReminderTitle は対象タイトルだけを抽出する", () => {
  const docs = [
    { id: "1", title: "週次まとめ 2026-11-01" },
    { id: "2", title: "週次まとめ 2026-10-25" },
  ];
  expect(filterDocumentsByReminderTitle(docs, "2026-11-01")).toEqual([{ id: "1", title: "週次まとめ 2026-11-01" }]);
});

test("runReminderWithMcp は obsidian / line の mcp_servers を指定して Claude API を呼ぶ", async () => {
  const payloads: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  const res = await runReminderWithMcp({
    settings: reminderSettingsFromEnv({
      OBSIDIAN_SUMMARY_FOLDER: "daily_note_summaries",
    }),
    credentials: {
      anthropicApiKey: "sk-ant-test",
      lineChannelAccessToken: "",
      lineUserId: "",
      mcpAuthToken: "mcp-reminder-token",
    },
    now: sundayNov8,
    fetchImpl: async (_url, options) => {
      payloads.push({
        headers: new Headers(options?.headers),
        body: JSON.parse(String(options?.body ?? "{}")),
      });
      return new Response(
        JSON.stringify({
          model: "claude-haiku-5-5",
          usage: { input_tokens: 15, output_tokens: 8 },
          content: [{ type: "text", text: "リマインダー通知完了" }],
        }),
        { status: 200 },
      );
    },
    recordUsage: async () => {},
  });

  expect(res.responseText).toBe("リマインダー通知完了");
  expect(payloads[0].headers.get("anthropic-beta")).toBe("mcp-client-2025-11-20");
  expect(payloads[0].body.mcp_servers).toEqual([
    {
      type: "url",
      url: "https://obsidian.infra-practice.jp/",
      name: "obsidian-s3",
      authorization_token: "mcp-reminder-token",
    },
    {
      type: "url",
      url: "https://line.infra-practice.jp/",
      name: "line-notification",
      authorization_token: "mcp-reminder-token",
    },
  ]);
});
