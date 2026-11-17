import { expect, test } from "vitest";
import { EMPTY_WEEK_MESSAGE } from "../line/helper.ts";
import { createdSinceDate, processWeekly, tokyoDate } from "./weekly.ts";

const now = new Date("2026-11-01T00:00:00Z");

type ProcessWeeklyArgs = Parameters<typeof processWeekly>[0];

function weekly(overrides: Partial<ProcessWeeklyArgs> = {}) {
  const calls: {
    push: string[];
    create: Array<{ title: string; markdown: string; folderId: string }>;
    move: string[][];
    read: string[];
    notesText?: string;
  } = { push: [], create: [], move: [], read: [] };
  const deps: ProcessWeeklyArgs = {
    documents: [
      { id: "doc-1", title: "月曜" },
      { id: "doc-2", title: "火曜" },
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
    ensureSummaryFolder: async () => "folder-summaries",
    createDocument: async (input) => {
      calls.create.push(input);
      return "summary-1";
    },
    moveDocuments: async (ids) => {
      calls.move.push(ids);
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

test("ノートがない週は固定のLINEメッセージを送りCraftへの書き込みをしない", async () => {
  const { calls, run } = weekly({ documents: [] });
  const summary = await run();
  expect(summary).toEqual({ summarized: 0, moved: 0 });
  expect(calls.push).toEqual([EMPTY_WEEK_MESSAGE]);
  expect(calls.create.length).toBe(0);
  expect(calls.move.length).toBe(0);
});

test("ノートがある週はLINE通知し要約を保存してから元ノートを移動する", async () => {
  const { calls, run } = weekly();
  const summary = await run();
  expect(summary).toEqual({ summarized: 2, moved: 2 });
  expect(calls.notesText?.includes("# 月曜")).toBe(true);
  expect(calls.notesText?.includes("doc-1の本文")).toBe(true);
  expect(calls.push[0].length).toBe(5000);
  expect(calls.create[0].title).toBe("週次まとめ 2026-11-01");
  expect(calls.create[0].folderId).toBe("folder-summaries");
  expect(calls.create[0].markdown.length).toBe(5001);
  expect(calls.move).toEqual([["doc-1", "doc-2"]]);
});

test("要約失敗時はLINE送信とノート移動をしない", async () => {
  const { calls, run } = weekly({
    summarize: async () => {
      throw new Error("model failed");
    },
  });
  await expect(run()).rejects.toThrow(/model failed/);
  expect(calls.push.length).toBe(0);
  expect(calls.create.length).toBe(0);
  expect(calls.move.length).toBe(0);
});

test("LINE失敗時は要約保存とノート移動をしない", async () => {
  const { calls, run } = weekly({
    pushLine: async () => {
      throw new Error("line failed");
    },
  });
  await expect(run()).rejects.toThrow(/line failed/);
  expect(calls.create.length).toBe(0);
  expect(calls.move.length).toBe(0);
});

test("Craft保存失敗時はノートを移動しない", async () => {
  const { calls, run } = weekly({
    createDocument: async () => {
      throw new Error("craft failed");
    },
  });
  await expect(run()).rejects.toThrow(/craft failed/);
  expect(calls.push.length).toBe(1);
  expect(calls.move.length).toBe(0);
});
