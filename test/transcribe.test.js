import assert from "node:assert/strict";
import test from "node:test";
import { createTranscription, parseTranscription } from "../lambda/transcribe/index.ts";

test("parseTranscription はJSONオブジェクトを読み取る", () => {
  const note = parseTranscription('{"title":"朝のメモ","markdown":"本文"}');
  assert.deepEqual(note, { title: "朝のメモ", markdown: "本文" });
});

test("parseTranscription はjsonコードフェンスを除去する", () => {
  const note = parseTranscription('```json\n{"title":"題","markdown":"## 見出し"}\n```');
  assert.equal(note.title, "題");
  assert.equal(note.markdown, "## 見出し");
});

test("parseTranscription はtitle欠落を拒否する", () => {
  assert.throws(() => parseTranscription('{"title":"  ","markdown":"本文"}'), /title/);
});

test("createClaudeTranscriber は画像をSonnetに送りJSONテキストを読み取る", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, headers: options.headers, body: JSON.parse(options.body) };
    return new Response(
      JSON.stringify({
        content: [{ type: "text", text: '{"title":"朝のメモ","markdown":"本文"}' }],
      }),
      { status: 200 },
    );
  };
  const { transcribe } = createTranscription({
    provider: "claude",
    claude: { apiKey: "test-key", fetchImpl },
  });
  const note = await transcribe({ bytes: Buffer.from("png"), mimeType: "image/png" });
  assert.deepEqual(note, { title: "朝のメモ", markdown: "本文" });
  assert.equal(request.url, "https://api.anthropic.com/v1/messages");
  assert.equal(request.headers["x-api-key"], "test-key");
  assert.equal(request.body.model, "claude-sonnet-5-5");
  assert.equal(request.body.messages[0].content[0].type, "image");
  assert.equal(request.body.messages[0].content[0].source.media_type, "image/png");
});

test("createTranscription はBedrock Nova Liteを選択する", async () => {
  let command;
  const client = {
    async send(value) {
      command = value;
      return { output: { message: { content: [{ text: '{"title":"題","markdown":"本文"}' }] } } };
    },
  };
  const { provider, transcribe } = createTranscription({
    provider: "bedrock",
    bedrock: { modelId: "amazon.nova-lite-v1:0", client },
  });
  const note = await transcribe({ bytes: Buffer.from("png"), mimeType: "image/png" });
  assert.equal(provider, "bedrock");
  assert.equal(note.title, "題");
  assert.equal(command.input.modelId, "amazon.nova-lite-v1:0");
  assert.equal(command.input.messages[0].content[1].image.format, "png");
});

test("createTranscription は未知のプロバイダを拒否する", () => {
  assert.throws(() => createTranscription({ provider: "other" }), /Unknown transcription provider/);
});
