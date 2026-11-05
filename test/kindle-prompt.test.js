import assert from "node:assert/strict";
import test from "node:test";
import { KINDLE_SYSTEM_PROMPT, KINDLE_USER_PROMPT } from "../lambda/kindle-prompt.js";

test("Kindleプロンプトはハイライトがある場合ハイライトのみの出力を要求する", () => {
  assert.match(KINDLE_USER_PROMPT, /ハイライトがある場合/);
  assert.match(KINDLE_USER_PROMPT, /ハイライトされた箇所/);
  assert.match(KINDLE_USER_PROMPT, /ページ全体の要約/);
  assert.match(KINDLE_SYSTEM_PROMPT, /ハイライトがある画像/);
});

test("KindleプロンプトはKindleマークアップにCraft赤ハイライトタグを使う", () => {
  assert.match(KINDLE_USER_PROMPT, /<highlight color="red">/);
  assert.match(KINDLE_SYSTEM_PROMPT, /<highlight color="red">/);
  assert.match(KINDLE_USER_PROMPT, /タグは使わない/);
});

test("Kindleプロンプトは大文字ハイライトを箇条書き補足の上に置く", () => {
  assert.match(KINDLE_USER_PROMPT, /大文字/);
  assert.match(KINDLE_USER_PROMPT, /リストにしない/);
  assert.match(KINDLE_USER_PROMPT, /ハイライト行のすぐ下/);
  assert.match(KINDLE_SYSTEM_PROMPT, /上:/);
  assert.match(KINDLE_SYSTEM_PROMPT, /下:/);
});
