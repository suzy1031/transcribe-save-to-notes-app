import assert from "node:assert/strict";
import test from "node:test";
import { createLinePush } from "../lambda/shared/job.ts";

test("createLinePush は資格情報が無いときログを出して戻る", async () => {
  const errors = [];
  const original = console.error;
  console.error = (message) => errors.push(message);
  try {
    const pushLine = createLinePush({});
    await pushLine("hello");
  } finally {
    console.error = original;
  }
  assert.deepEqual(errors, ["LINE通知失敗: credentials are missing"]);
});

test("createLinePush は送信失敗をログに残して例外を出さない", async () => {
  const errors = [];
  const original = console.error;
  console.error = (message) => errors.push(message);
  try {
    const pushLine = createLinePush({ lineChannelAccessToken: "token", lineUserId: "user" }, async () => {
      throw new Error("Bearer sk-ant-secretvalue failed");
    });
    await pushLine("hello");
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^LINE通知失敗:/);
  assert.equal(errors[0].includes("sk-ant-secretvalue"), false);
});
