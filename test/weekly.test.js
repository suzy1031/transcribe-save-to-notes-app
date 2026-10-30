import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_WEEK_MESSAGE } from "../lambda/line.js";
import { createdSinceDate, processWeekly, tokyoDate } from "../lambda/weekly.js";

const now = new Date("2026-11-01T00:00:00Z");

function weekly(overrides) {
  const calls = { push: [], create: [], move: [], read: [] };
  const deps = {
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

test("createdSinceDate is seven calendar days before the Tokyo date", () => {
  assert.equal(tokyoDate(now), "2026-11-01");
  assert.equal(createdSinceDate(now), "2026-10-25");
  assert.equal(tokyoDate(new Date("2026-10-31T16:00:00Z")), "2026-11-01");
});

test("an empty week sends the fixed LINE message and skips Craft writes", async () => {
  const { calls, run } = weekly({ documents: [] });
  const summary = await run();
  assert.deepEqual(summary, { summarized: 0, moved: 0 });
  assert.deepEqual(calls.push, [EMPTY_WEEK_MESSAGE]);
  assert.equal(calls.create.length, 0);
  assert.equal(calls.move.length, 0);
});

test("a week with notes notifies LINE, saves the full summary, then moves the source notes", async () => {
  const { calls, run } = weekly();
  const summary = await run();
  assert.deepEqual(summary, { summarized: 2, moved: 2 });
  assert.equal(calls.notesText.includes("# 月曜"), true);
  assert.equal(calls.notesText.includes("doc-1の本文"), true);
  assert.equal(calls.push[0].length, 5000);
  assert.equal(calls.create[0].title, "週次まとめ 2026-11-01");
  assert.equal(calls.create[0].folderId, "folder-summaries");
  assert.equal(calls.create[0].markdown.length, 5001);
  assert.deepEqual(calls.move, [["doc-1", "doc-2"]]);
});

test("a summary failure does not send LINE or move notes", async () => {
  const { calls, run } = weekly({
    summarize: async () => {
      throw new Error("model failed");
    },
  });
  await assert.rejects(run, /model failed/);
  assert.equal(calls.push.length, 0);
  assert.equal(calls.create.length, 0);
  assert.equal(calls.move.length, 0);
});

test("a LINE failure does not save the summary or move notes", async () => {
  const { calls, run } = weekly({
    pushLine: async () => {
      throw new Error("line failed");
    },
  });
  await assert.rejects(run, /line failed/);
  assert.equal(calls.create.length, 0);
  assert.equal(calls.move.length, 0);
});

test("a Craft save failure does not move notes", async () => {
  const { calls, run } = weekly({
    createDocument: async () => {
      throw new Error("craft failed");
    },
  });
  await assert.rejects(run, /craft failed/);
  assert.equal(calls.push.length, 1);
  assert.equal(calls.move.length, 0);
});
