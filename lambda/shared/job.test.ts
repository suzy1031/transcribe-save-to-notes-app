import { expect, test, vi } from "vitest";
import { createLinePush } from "./job.ts";

test("createLinePush は資格情報が無いときログを出して戻る", async () => {
  const errors: unknown[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((message: unknown) => {
    errors.push(message);
  });
  try {
    const pushLine = createLinePush({});
    await pushLine("hello");
  } finally {
    spy.mockRestore();
  }
  expect(errors).toEqual(["LINE通知失敗: credentials are missing"]);
});

test("createLinePush は送信失敗をログに残して例外を出さない", async () => {
  const errors: unknown[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((message: unknown) => {
    errors.push(message);
  });
  try {
    const pushLine = createLinePush({ lineChannelAccessToken: "token", lineUserId: "user" }, async () => {
      throw new Error("Bearer sk-ant-secretvalue failed");
    });
    await pushLine("hello");
  } finally {
    spy.mockRestore();
  }
  expect(errors.length).toBe(1);
  expect(String(errors[0])).toMatch(/^LINE通知失敗:/);
  expect(String(errors[0]).includes("sk-ant-secretvalue")).toBe(false);
});
