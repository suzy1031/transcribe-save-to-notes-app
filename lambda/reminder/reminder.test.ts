import { expect, test, vi } from "vitest";
import { EMPTY_REMINDER_MESSAGE, reminderDeliveredMessage, reminderFailedMessage } from "../line/helper.ts";
import { obsidianAppNoteLink } from "../obsidian/helper.ts";
import { tokyoDate } from "../shared/tokyo-date.ts";
import {
  filterDocumentsByReminderTitle,
  listReminderDocuments,
  notifyReminderLineError,
  processReminder,
  reminderSettingsFromEnv,
  reminderTargetDate,
  reminderTitleCandidates,
  runReminderWithMcp,
} from "./reminder.ts";

const sundayNov8 = new Date("2026-11-07T15:00:00Z");

type ProcessReminderArgs = Parameters<typeof processReminder>[0];

function reminder(overrides: Partial<ProcessReminderArgs> = {}) {
  const calls: { push: string[] } = { push: [] };
  const deps: ProcessReminderArgs = {
    documents: [{ id: "daily_note_summaries/週次まとめ 2026-11-01.md", title: "週次まとめ 2026-11-01" }],
    pushLine: async (text) => {
      calls.push.push(text);
    },
    vaultName: "ks-vault",
    targetDate: "2026-11-01",
    ...overrides,
  };
  return { calls, run: () => processReminder(deps) };
}

test("reminderTargetDate は東京日付の7暦日前を返す", () => {
  expect(tokyoDate(sundayNov8)).toBe("2026-11-08");
  expect(reminderTargetDate(sundayNov8)).toBe("2026-11-01");
});

test("reminderTitleCandidates はゼロ埋めと非ゼロ埋め日付のタイトルを返す", () => {
  expect(reminderTitleCandidates("2026-11-01")).toEqual(["週次まとめ 2026-11-01", "週次まとめ 2026-11-1"]);
});

test("filterDocumentsByReminderTitle は対象日の週次まとめタイトルのみ残す", () => {
  const documents = [
    { id: "a", title: "週次まとめ 2026-11-01" },
    { id: "b", title: "週次まとめ 2026-11-08" },
    { id: "c", title: "メモ" },
  ];
  expect(filterDocumentsByReminderTitle(documents, "2026-11-01")).toEqual([
    { id: "a", title: "週次まとめ 2026-11-01" },
  ]);
});

test("listReminderDocuments は作成日0件のときタイトルでフォルダ内を探す", async () => {
  const calls: Array<{ folder: string; createdDateGte?: string; createdDateLte?: string }> = [];
  const obsidian = {
    listNotes: async (query: { folder: string; createdDateGte?: string; createdDateLte?: string }) => {
      calls.push(query);
      if (query.createdDateLte === "2026-11-01") return [];
      return [
        {
          id: "daily_note_summaries/週次まとめ 2026-11-01.md",
          key: "daily_note_summaries/週次まとめ 2026-11-01.md",
          title: "週次まとめ 2026-11-01",
          createdDate: "2026-10-31",
        },
        {
          id: "daily_note_summaries/週次まとめ 2026-10-25.md",
          key: "daily_note_summaries/週次まとめ 2026-10-25.md",
          title: "週次まとめ 2026-10-25",
          createdDate: "2026-10-25",
        },
      ];
    },
  };
  const result = await listReminderDocuments(obsidian, "daily_note_summaries", "2026-11-01");
  expect(result.matchedBy).toBe("title");
  expect(result.documents.length).toBe(1);
  expect(result.documents[0].id).toBe("daily_note_summaries/週次まとめ 2026-11-01.md");
  expect(calls.length).toBe(2);
});

test("一致するノートがない場合は固定のLINEメッセージを送る", async () => {
  const { calls, run } = reminder({ documents: [] });
  const result = await run();
  expect(result).toEqual({ reminded: 0 });
  expect(calls.push).toEqual([EMPTY_REMINDER_MESSAGE]);
});

test("一致するノートが1件の場合はタイトルとObsidianアプリリンクを送る", async () => {
  const { calls, run } = reminder();
  const result = await run();
  expect(result).toEqual({ reminded: 1, documentId: "daily_note_summaries/週次まとめ 2026-11-01.md" });
  expect(calls.push).toEqual([
    reminderDeliveredMessage(
      "週次まとめ 2026-11-01",
      obsidianAppNoteLink("ks-vault", "daily_note_summaries/週次まとめ 2026-11-01.md"),
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
  await expect(run()).rejects.toThrow(/expected exactly one/);
  expect(calls.push.length).toBe(0);
});

test("notifyReminderLineError は失敗メッセージをpushする", async () => {
  const calls: { push: string[] } = { push: [] };
  const line = {
    push: async (text: string) => {
      calls.push.push(text);
    },
  };
  await notifyReminderLineError({
    line,
    credentials: null,
    error: new Error("expected exactly one"),
  });
  expect(calls.push).toEqual([reminderFailedMessage("expected exactly one")]);
});

test("notifyReminderLineError はLINE認証情報がない場合にログを出す", async () => {
  const errors: unknown[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((message: unknown) => {
    errors.push(message);
  });
  try {
    await notifyReminderLineError({
      line: null,
      credentials: {},
      error: new Error("s3 failed"),
    });
  } finally {
    spy.mockRestore();
  }
  expect(errors[0]).toBe("LINE通知失敗: credentials are missing");
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
