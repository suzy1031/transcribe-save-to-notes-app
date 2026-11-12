import assert from "node:assert/strict";
import test from "node:test";
import {
  formatHttpErrorDetail,
  parseApiErrorDetail,
  redactSecrets,
  sanitizeErrorMessage,
} from "../lambda/sanitize-error.ts";

test("parseApiErrorDetail はJSONのerror.messageを読み取る", () => {
  const body = JSON.stringify({ error: { message: "folder not found" } });
  assert.equal(parseApiErrorDetail(body), "folder not found");
});

test("parseApiErrorDetail はBearerトークンをマスクする", () => {
  const body = "Unauthorized Bearer sk-live-abcdefghijklmnop";
  assert.equal(parseApiErrorDetail(body), "Unauthorized Bearer [REDACTED]");
});

test("formatHttpErrorDetail は本文が無いときstatusTextにフォールバックする", () => {
  assert.equal(formatHttpErrorDetail(502, "", "Bad Gateway"), "502 Bad Gateway");
  assert.equal(formatHttpErrorDetail(500, "", ""), "500");
});

test("sanitizeErrorMessage は通知用に長いメッセージを切り詰める", () => {
  const long = `failed ${"x".repeat(300)}`;
  assert.equal(sanitizeErrorMessage(long).length, 200);
  assert.equal(redactSecrets("token=abc123"), "token=[REDACTED]");
});
