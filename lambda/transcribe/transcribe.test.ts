import { expect, test } from "vitest";
import { createTranscription, parseTranscription } from "./index.ts";

test("parseTranscription はJSONオブジェクトを読み取る", () => {
  const note = parseTranscription('{"title":"朝のメモ","markdown":"本文"}');
  expect(note).toEqual({ title: "朝のメモ", markdown: "本文" });
});

test("parseTranscription はjsonコードフェンスを除去する", () => {
  const note = parseTranscription('```json\n{"title":"題","markdown":"## 見出し"}\n```');
  expect(note.title).toBe("題");
  expect(note.markdown).toBe("## 見出し");
});

test("parseTranscription はtitle欠落を拒否する", () => {
  expect(() => parseTranscription('{"title":"  ","markdown":"本文"}')).toThrow(/title/);
});

test("createClaudeTranscriber は画像をSonnetに送りJSONテキストを読み取る", async () => {
  let request:
    | {
        url: string;
        headers: Headers;
        body: {
          model: string;
          system: string;
          messages: Array<{ content: Array<{ type: string; source: { media_type: string } }> }>;
        };
      }
    | undefined;
  const fetchImpl: typeof fetch = async (url, options) => {
    request = {
      url: String(url),
      headers: new Headers(options?.headers),
      body: JSON.parse(String(options?.body ?? "")),
    };
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
  expect(note).toEqual({ title: "朝のメモ", markdown: "本文" });
  expect(request?.url).toBe("https://api.anthropic.com/v1/messages");
  expect(request?.headers.get("x-api-key")).toBe("test-key");
  expect(request?.body.model).toBe("claude-sonnet-5-5");
  expect(request?.body.system).toContain("Obsidian Flavored Markdown");
  expect(request?.body.system).toContain("YAML frontmatter");
  expect(request?.body.messages[0].content[0].type).toBe("image");
  expect(request?.body.messages[0].content[0].source.media_type).toBe("image/png");
});

test("createTranscription はBedrock Nova Liteを選択する", async () => {
  let command:
    | { input: { modelId: string; messages: Array<{ content: Array<{ image: { format: string } }> }> } }
    | undefined;
  const client = {
    async send(value: unknown) {
      command = value as typeof command;
      return { output: { message: { content: [{ text: '{"title":"題","markdown":"本文"}' }] } } };
    },
  };
  const { provider, transcribe } = createTranscription({
    provider: "bedrock",
    bedrock: { modelId: "amazon.nova-lite-v1:0", client },
  });
  const note = await transcribe({ bytes: Buffer.from("png"), mimeType: "image/png" });
  expect(provider).toBe("bedrock");
  expect(note.title).toBe("題");
  expect(command?.input.modelId).toBe("amazon.nova-lite-v1:0");
  expect(command?.input.messages[0].content[1].image.format).toBe("png");
});

test("createTranscription は未知のプロバイダを拒否する", () => {
  expect(() => createTranscription({ provider: "other" as "claude" })).toThrow(/Unknown transcription provider/);
});
