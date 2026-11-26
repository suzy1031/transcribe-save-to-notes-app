import { expect, test, vi } from "vitest";
import { runLogged } from "./job.ts";

test("runLogged は正常終了時に start と end を出力して戻り値を返す", async () => {
  const logs: unknown[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((message: unknown) => {
    logs.push(message);
  });
  try {
    const result = await runLogged(async () => "ok");
    expect(result).toBe("ok");
  } finally {
    spy.mockRestore();
  }
  expect(logs).toEqual(["start", "end"]);
});

test("runLogged は例外発生時も end を出力して例外を再送出する", async () => {
  const logs: unknown[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((message: unknown) => {
    logs.push(message);
  });
  try {
    await expect(
      runLogged(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
  } finally {
    spy.mockRestore();
  }
  expect(logs).toEqual(["start", "end"]);
});
