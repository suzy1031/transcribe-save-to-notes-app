import { expect, test } from "vitest";
import { KINDLE_SYSTEM_PROMPT, KINDLE_USER_PROMPT } from "./kindle-prompt.ts";

test("Kindleプロンプトはハイライトがある場合ハイライトのみの出力を要求する", () => {
  expect(KINDLE_USER_PROMPT).toMatch(/ハイライトがある場合/);
  expect(KINDLE_USER_PROMPT).toMatch(/ハイライトされた箇所/);
  expect(KINDLE_USER_PROMPT).toMatch(/ページ全体の要約/);
  expect(KINDLE_SYSTEM_PROMPT).toMatch(/ハイライトがある画像/);
});

test("KindleプロンプトはKindleハイライトにObsidianの==記法を使う", () => {
  expect(KINDLE_USER_PROMPT).toMatch(/==\.\.\.==/);
  expect(KINDLE_SYSTEM_PROMPT).toMatch(/==大文字のハイライトテキスト==/);
  expect(KINDLE_USER_PROMPT).toMatch(/ハイライト記法は使わない/);
});

test("Kindleプロンプトは大文字ハイライトを箇条書き補足の上に置く", () => {
  expect(KINDLE_USER_PROMPT).toMatch(/大文字/);
  expect(KINDLE_USER_PROMPT).toMatch(/リストにしない/);
  expect(KINDLE_USER_PROMPT).toMatch(/ハイライト行のすぐ下/);
  expect(KINDLE_SYSTEM_PROMPT).toMatch(/上:/);
  expect(KINDLE_SYSTEM_PROMPT).toMatch(/下:/);
});
