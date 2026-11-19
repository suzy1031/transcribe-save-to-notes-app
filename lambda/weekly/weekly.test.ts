import { expect, test } from "vitest";
import { EMPTY_WEEK_MESSAGE } from "../line/helper.ts";
import { tokyoDate } from "../shared/tokyo-date.ts";
import { createdSinceDate, processWeekly } from "./weekly.ts";

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
