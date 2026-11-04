import assert from "node:assert/strict";
import test from "node:test";
import { KINDLE_SYSTEM_PROMPT, KINDLE_USER_PROMPT } from "../lambda/kindle-prompt.js";

test("Kindle prompts require highlight-only output when highlights exist", () => {
  assert.match(KINDLE_USER_PROMPT, /ハイライトがある場合/);
  assert.match(KINDLE_USER_PROMPT, /ハイライトされた箇所/);
  assert.match(KINDLE_USER_PROMPT, /ページ全体の要約/);
  assert.match(KINDLE_SYSTEM_PROMPT, /ハイライトがある画像/);
});

test("Kindle prompts use Craft red highlight tags for Kindle markup", () => {
  assert.match(KINDLE_USER_PROMPT, /<highlight color="red">/);
  assert.match(KINDLE_SYSTEM_PROMPT, /<highlight color="red">/);
  assert.match(KINDLE_USER_PROMPT, /タグは使わない/);
});

test("Kindle prompts put caps highlight text above bullet supplements", () => {
  assert.match(KINDLE_USER_PROMPT, /大文字/);
  assert.match(KINDLE_USER_PROMPT, /リストにしない/);
  assert.match(KINDLE_USER_PROMPT, /ハイライト行のすぐ下/);
  assert.match(KINDLE_SYSTEM_PROMPT, /上:/);
  assert.match(KINDLE_SYSTEM_PROMPT, /下:/);
});
