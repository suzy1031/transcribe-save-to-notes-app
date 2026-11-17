import { expect, test } from "vitest";
import { formatHttpErrorDetail, parseApiErrorDetail, redactSecrets, sanitizeErrorMessage } from "./sanitize-error.ts";

test("parseApiErrorDetail はJSONのerror.messageを読み取る", () => {
  const body = JSON.stringify({ error: { message: "folder not found" } });
  expect(parseApiErrorDetail(body)).toBe("folder not found");
});

test("parseApiErrorDetail はBearerトークンをマスクする", () => {
  const body = "Unauthorized Bearer sk-live-abcdefghijklmnop";
  expect(parseApiErrorDetail(body)).toBe("Unauthorized Bearer [REDACTED]");
});

test("formatHttpErrorDetail は本文が無いときstatusTextにフォールバックする", () => {
  expect(formatHttpErrorDetail(502, "", "Bad Gateway")).toBe("502 Bad Gateway");
  expect(formatHttpErrorDetail(500, "", "")).toBe("500");
});

test("sanitizeErrorMessage は通知用に長いメッセージを切り詰める", () => {
  const long = `failed ${"x".repeat(300)}`;
  expect(sanitizeErrorMessage(long).length).toBe(200);
  expect(redactSecrets("token=abc123")).toBe("token=[REDACTED]");
});
