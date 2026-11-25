import { expect, test } from "vitest";
import { tokyoDate } from "../shared/tokyo-date.ts";
import { createdSinceDate, runWeeklyWithMcp, weeklySettingsFromEnv } from "./weekly.ts";

const now = new Date("2026-11-01T00:00:00Z");

test("createdSinceDate は実行日から7日前の東京日付を返す", () => {
  expect(tokyoDate(now)).toBe("2026-11-01");
  expect(createdSinceDate(now)).toBe("2026-10-25");
});

test("runWeeklyWithMcp は obsidian / line / usage の mcp_servers を指定して Claude API を呼ぶ", async () => {
  const payloads: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  const res = await runWeeklyWithMcp({
    settings: weeklySettingsFromEnv({
      CLAUDE_MODEL_ID: "claude-haiku-5-5",
      OBSIDIAN_DAILY_FOLDER: "00_daily_notes",
      OBSIDIAN_SUMMARY_FOLDER: "daily_note_summaries",
    }),
    credentials: {
      anthropicApiKey: "sk-ant-test",
      lineChannelAccessToken: "",
      lineUserId: "",
      mcpAuthToken: "mcp-token-123",
    },
    now,
    fetchImpl: async (_url, options) => {
      payloads.push({
        headers: new Headers(options?.headers),
        body: JSON.parse(String(options?.body ?? "{}")),
      });
      return new Response(
        JSON.stringify({
          model: "claude-haiku-5-5",
          usage: { input_tokens: 20, output_tokens: 10 },
          content: [{ type: "text", text: "週次要約をMCP経由で完了しました" }],
        }),
        { status: 200 },
      );
    },
    recordUsage: async () => {},
  });

  expect(res.responseText).toBe("週次要約をMCP経由で完了しました");
  expect(payloads[0].headers.get("anthropic-beta")).toBe("mcp-client-2025-11-20");
  expect(payloads[0].body.mcp_servers).toEqual([
    {
      type: "url",
      url: "https://obsidian.infra-practice.jp/",
      name: "obsidian-s3",
      authorization_token: "mcp-token-123",
    },
    {
      type: "url",
      url: "https://line.infra-practice.jp/",
      name: "line-notification",
      authorization_token: "mcp-token-123",
    },
    {
      type: "url",
      url: "https://usage.infra-practice.jp/",
      name: "claude-usage",
      authorization_token: "mcp-token-123",
    },
  ]);
});
