import { expect, test } from "vitest";
import {
  bedrockImageFormat,
  buildMcpServerDefinitions,
  callClaudeMessages,
  converseBedrock,
  extractBedrockText,
  extractClaudeText,
  imageMediaType,
  requireAnthropicApiKey,
  requireNonEmptyText,
} from "./llm.ts";

test("requireAnthropicApiKey はAPIキー未指定を拒否する", () => {
  expect(() => requireAnthropicApiKey("")).toThrow(/Anthropic API key is required/);
  expect(() => requireAnthropicApiKey(undefined)).toThrow(/Anthropic API key is required/);
  expect(requireAnthropicApiKey("sk-test")).toBe("sk-test");
});

test("imageMediaType と bedrockImageFormat は PNG/JPEG を判定し未知の形式を拒否する", () => {
  expect(imageMediaType("image/png")).toBe("image/png");
  expect(imageMediaType("image/jpeg")).toBe("image/jpeg");
  expect(() => imageMediaType("image/webp")).toThrow(/Unsupported image type: image\/webp/);

  expect(bedrockImageFormat("image/png")).toBe("png");
  expect(bedrockImageFormat("image/jpeg")).toBe("jpeg");
  expect(() => bedrockImageFormat(undefined)).toThrow(/Unsupported image type: undefined/);
});

test("extractClaudeText は text ブロックだけを連結する", () => {
  expect(
    extractClaudeText({
      content: [
        { type: "thinking", text: "内部思考" },
        { type: "text", text: "前半" },
        { type: "text", text: "後半" },
      ],
    }),
  ).toBe("前半後半");
  expect(extractClaudeText({})).toBe("");
});

test("extractBedrockText は Bedrock の content テキストを連結する", () => {
  expect(extractBedrockText({ output: { message: { content: [{ text: "A" }, { text: "B" }] } } })).toBe("AB");
  expect(extractBedrockText({})).toBe("");
});

test("requireNonEmptyText は空文字を拒否する", () => {
  expect(() => requireNonEmptyText("  \n ", "Summary was empty")).toThrow("Summary was empty");
  expect(requireNonEmptyText("本文", "Summary was empty")).toBe("本文");
});

test("callClaudeMessages は thinking の有無・使用量記録・text抽出を行う", async () => {
  const requests: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  const usages: Array<{ functionName?: string; modelId: string; usage?: unknown }> = [];

  const text = await callClaudeMessages({
    apiKey: "test-key",
    modelId: "claude-haiku-5-5",
    maxTokens: 2048,
    system: "sys",
    messages: [{ role: "user", content: "hello" }],
    functionName: "weekly",
    errorPrefix: "Claude summary failed",
    fetchImpl: async (_url, options) => {
      requests.push({
        headers: new Headers(options?.headers),
        body: JSON.parse(String(options?.body ?? "{}")),
      });
      return new Response(
        JSON.stringify({
          model: "claude-haiku-5-5-actual",
          usage: { input_tokens: 10, output_tokens: 5 },
          content: [{ type: "text", text: "結果" }],
        }),
        { status: 200 },
      );
    },
    recordUsage: async (entry) => {
      usages.push(entry);
    },
  });

  expect(text).toBe("結果");
  expect(requests[0].headers.get("x-api-key")).toBe("test-key");
  expect(requests[0].headers.get("anthropic-version")).toBe("2023-06-01");
  expect("thinking" in requests[0].body).toBe(false);
  expect(usages).toEqual([
    {
      functionName: "weekly",
      modelId: "claude-haiku-5-5-actual",
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  ]);
});

test("callClaudeMessages はエラー時に機密情報をマスクして例外を投げる", async () => {
  await expect(
    callClaudeMessages({
      apiKey: "test-key",
      modelId: "claude-sonnet-5-5",
      maxTokens: 4096,
      thinking: { type: "between_tools" },
      system: "sys",
      messages: [{ role: "user", content: "hello" }],
      functionName: "index",
      errorPrefix: "Claude transcription failed",
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: { message: "Invalid key sk-ant-secretvalue123456" } }), {
          status: 401,
          statusText: "Unauthorized",
        }),
      recordUsage: async () => {},
    }),
  ).rejects.toThrow(/^Claude transcription failed: 401 Invalid key \[REDACTED\]$/);
});

test("converseBedrock は ConverseCommand を送信しテキストを返す", async () => {
  let sent:
    | {
        input: {
          modelId: string;
          system: Array<{ text: string }>;
          inferenceConfig: { maxTokens: number; temperature: number };
        };
      }
    | undefined;
  const text = await converseBedrock({
    client: {
      send: async (command) => {
        sent = command as unknown as typeof sent;
        return { output: { message: { content: [{ text: "Bedrock応答" }] } } };
      },
    },
    modelId: "amazon.nova-lite-v1:0",
    maxTokens: 1024,
    system: "sys",
    messages: [{ role: "user", content: [{ text: "hi" }] }],
  });

  expect(text).toBe("Bedrock応答");
  expect(sent?.input.modelId).toBe("amazon.nova-lite-v1:0");
  expect(sent?.input.system).toEqual([{ text: "sys" }]);
  expect(sent?.input.inferenceConfig).toEqual({ maxTokens: 1024, temperature: 0 });
});

test("callClaudeMessages は mcpServers 指定時に anthropic-beta と mcp_servers / mcp_toolset を送信する", async () => {
  const requests: Array<{ headers: Headers; body: Record<string, unknown> }> = [];
  const mcpServers = buildMcpServerDefinitions({
    domains: ["obsidian", "drive"],
    authToken: "mcp-secret",
  });

  expect(mcpServers).toEqual([
    { type: "url", url: "https://obsidian.infra-practice.jp/", name: "obsidian-s3", authorization_token: "mcp-secret" },
    { type: "url", url: "https://drive.infra-practice.jp/", name: "google-drive", authorization_token: "mcp-secret" },
  ]);

  const text = await callClaudeMessages({
    apiKey: "test-key",
    modelId: "claude-haiku-5-5",
    maxTokens: 2048,
    system: "sys",
    messages: [{ role: "user", content: "MCPで実行して" }],
    mcpServers,
    functionName: "weekly",
    errorPrefix: "Claude MCP failed",
    fetchImpl: async (_url, options) => {
      requests.push({
        headers: new Headers(options?.headers),
        body: JSON.parse(String(options?.body ?? "{}")),
      });
      return new Response(
        JSON.stringify({
          model: "claude-haiku-5-5",
          usage: { input_tokens: 15, output_tokens: 8 },
          content: [{ type: "text", text: "完了" }],
        }),
        { status: 200 },
      );
    },
    recordUsage: async () => {},
  });

  expect(text).toBe("完了");
  expect(requests[0].headers.get("anthropic-beta")).toBe("mcp-client-2025-11-20");
  expect(requests[0].body.mcp_servers).toEqual(mcpServers);
  expect(requests[0].body.tools).toEqual([
    { type: "mcp_toolset", mcp_server_name: "obsidian-s3" },
    { type: "mcp_toolset", mcp_server_name: "google-drive" },
  ]);
});
