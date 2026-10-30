import assert from "node:assert/strict";
import test from "node:test";
import { createTranscription, parseTranscription } from "../lambda/transcribe/index.js";

test("parseTranscription reads a JSON object", () => {
  const note = parseTranscription('{"title":"朝のメモ","markdown":"本文"}');
  assert.deepEqual(note, { title: "朝のメモ", markdown: "本文" });
});

test("parseTranscription strips a json code fence", () => {
  const note = parseTranscription('```json\n{"title":"題","markdown":"## 見出し"}\n```');
  assert.equal(note.title, "題");
  assert.equal(note.markdown, "## 見出し");
});

test("parseTranscription rejects a missing title", () => {
  assert.throws(() => parseTranscription('{"title":"  ","markdown":"本文"}'), /title/);
});

test("createClaudeTranscriber sends the image to Haiku and reads the JSON text", async () => {
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
  assert.equal(request.body.model, "claude-haiku-5-5");
  assert.equal(request.body.messages[0].content[0].type, "image");
  assert.equal(request.body.messages[0].content[0].source.media_type, "image/png");
});

test("createTranscription selects Bedrock Nova Lite", async () => {
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

test("createTranscription rejects an unknown provider", () => {
  assert.throws(() => createTranscription({ provider: "other" }), /Unknown transcription provider/);
});
