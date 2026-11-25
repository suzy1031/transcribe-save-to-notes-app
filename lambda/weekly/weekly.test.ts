import { expect, test } from "vitest";
import { EMPTY_WEEK_MESSAGE } from "../line/helper.ts";
import { tokyoDate } from "../shared/tokyo-date.ts";
import { createdSinceDate, processWeekly, runWeeklyWithMcp, weeklySettingsFromEnv } from "./weekly.ts";

const now = new Date("2026-11-01T00:00:00Z");

type ProcessWeeklyArgs = Parameters<typeof processWeekly>[0];

function weekly(overrides: Partial<ProcessWeeklyArgs> = {}) {
  const calls: {
    push: string[];
    create: Array<{ title: string; markdown: string; date: string }>;
    read: string[];
    notesText?: string;
  } = { push: [], create: [], read: [] };
  const deps: ProcessWeeklyArgs = {
    documents: [
      { id: "00_daily_notes/2026-10-26.md", title: "月曜" },
      { id: "00_daily_notes/2026-10-27.md", title: "火曜" },
    ],
    readMarkdown: async (id) => {
      calls.read.push(id);
      return `${id}の本文`;
    },
    summarize: async (notesText) => {
      calls.notesText = notesText;
      return "あ".repeat(5001);
    },
    pushLine: async (text) => {
      calls.push.push(text);
    },
    saveSummaryNote: async (input) => {
      calls.create.push(input);
      return "daily_note_summaries/週次まとめ 2026-11-01.md";
    },
    now,
    ...overrides,
  };
  return { calls, run: () => processWeekly(deps) };
}

test("createdSinceDate は東京日付の7暦日前を返す", () => {
  expect(tokyoDate(now)).toBe("2026-11-01");
  expect(createdSinceDate(now)).toBe("2026-10-25");
  expect(tokyoDate(new Date("2026-10-31T16:00:00Z"))).toBe("2026-11-01");
});

test("ノートがない週は固定のLINEメッセージを送りS3への書き込みをしない", async () => {
  const { calls, run } = weekly({ documents: [] });
  const summary = await run();
  expect(summary).toEqual({ summarized: 0 });
  expect(calls.push).toEqual([EMPTY_WEEK_MESSAGE]);
  expect(calls.create.length).toBe(0);
});

test("ノートがある週はLINE通知し週次まとめノートを保存する", async () => {
  const { calls, run } = weekly();
  const summary = await run();
  expect(summary).toEqual({ summarized: 2 });
  expect(calls.notesText?.includes("# 月曜")).toBe(true);
  expect(calls.notesText?.includes("00_daily_notes/2026-10-26.mdの本文")).toBe(true);
  expect(calls.push[0].length).toBe(5000);
  expect(calls.create[0].title).toBe("週次まとめ 2026-11-01");
  expect(calls.create[0].date).toBe("2026-11-01");
  expect(calls.create[0].markdown.length).toBe(5001);
});

test("要約失敗時はLINE送信と要約保存をしない", async () => {
  const { calls, run } = weekly({
    summarize: async () => {
      throw new Error("model failed");
    },
  });
  await expect(run()).rejects.toThrow(/model failed/);
  expect(calls.push.length).toBe(0);
  expect(calls.create.length).toBe(0);
});

test("LINE失敗時は要約保存をしない", async () => {
  const { calls, run } = weekly({
    pushLine: async () => {
      throw new Error("line failed");
    },
  });
  await expect(run()).rejects.toThrow(/line failed/);
  expect(calls.create.length).toBe(0);
});

test("S3保存失敗時は例外を投げる", async () => {
  const { calls, run } = weekly({
    saveSummaryNote: async () => {
      throw new Error("s3 failed");
    },
  });
  await expect(run()).rejects.toThrow(/s3 failed/);
  expect(calls.push.length).toBe(1);
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
