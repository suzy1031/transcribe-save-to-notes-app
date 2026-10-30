import assert from "node:assert/strict";
import test from "node:test";
import { combineNotes, summaryPrompt } from "../lambda/summary-prompt.js";
import { createBedrockSummarizer, createClaudeSummarizer } from "../lambda/summarize.js";

test("summaryPrompt inserts the combined notes under the requested headings", () => {
  const notes = combineNotes([
    { title: "月曜", markdown: "会議メモ" },
    { title: "火曜", markdown: "決定事項" },
  ]);
  const prompt = summaryPrompt(notes);
  assert.match(prompt, /【週次Craftノートまとめ】/);
  assert.match(prompt, /📌 今週のハイライト/);
  assert.match(prompt, /📝 主なトピックと決定事項/);
  assert.match(prompt, /🚀 来週への持ち越し・アクションアイテム/);
  assert.match(prompt, /# 月曜\n\n会議メモ\n\n# 火曜\n\n決定事項/);
  assert.equal(prompt.includes("{統合されたCraftノートテキスト}"), false);
});

test("createClaudeSummarizer sends the prompt and returns the text", async () => {
  let body;
  const summarize = createClaudeSummarizer({
    apiKey: "anthropic-key",
    modelId: "claude-haiku-5-5",
    fetchImpl: async (url, options) => {
      body = { url, apiKey: options.headers["x-api-key"], payload: JSON.parse(options.body) };
      return new Response(JSON.stringify({ content: [{ type: "text", text: "【週次Craftノートまとめ】" }] }), {
        status: 200,
      });
    },
  });
  const text = await summarize("ノート");
  assert.equal(text, "【週次Craftノートまとめ】");
  assert.equal(body.url, "https://api.anthropic.com/v1/messages");
  assert.equal(body.apiKey, "anthropic-key");
  assert.equal(body.payload.max_tokens, 2048);
  assert.equal(body.payload.messages[0].content.includes("ノート"), true);
});

test("createBedrockSummarizer sends the prompt and returns the text", async () => {
  let command;
  const summarize = createBedrockSummarizer({
    modelId: "amazon.nova-lite-v1:0",
    client: {
      send: async (input) => {
        command = input;
        return { output: { message: { content: [{ text: "まとめ" }] } } };
      },
    },
  });
  const text = await summarize("ノート");
  assert.equal(text, "まとめ");
  assert.equal(command.input.modelId, "amazon.nova-lite-v1:0");
  assert.equal(command.input.inferenceConfig.maxTokens, 2048);
  assert.equal(command.input.messages[0].content[0].text.includes("ノート"), true);
});
