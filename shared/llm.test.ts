import { expect, test } from "vitest";
import {
  buildMcpServerDefinitions,
  callClaudeMessages,
  exchangeWifToken,
  extractClaudeText,
  imageMediaType,
  requireAnthropicApiKey,
  requireNonEmptyText,
  resolveAnthropicAuth,
} from "./llm.ts";
import { settingsFromEnv } from "./settings.ts";

test("requireAnthropicApiKey はAPIキー未指定を拒否する", () => {
  expect(() => requireAnthropicApiKey("")).toThrow(/Anthropic API key is required/);
  expect(() => requireAnthropicApiKey(undefined)).toThrow(/Anthropic API key is required/);
  expect(requireAnthropicApiKey("sk-test")).toBe("sk-test");
});

test("imageMediaType は PNG/JPEG を判定し未知の形式を拒否する", () => {
  expect(imageMediaType("image/png")).toBe("image/png");
  expect(imageMediaType("image/jpeg")).toBe("image/jpeg");
  expect(() => imageMediaType("image/webp")).toThrow(/Unsupported image type: image\/webp/);
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

test("callClaudeMessages は stop_reason が pause_turn のとき assistant 応答を積んで継続する", async () => {
  const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  const usages: Array<{ input_tokens?: number; output_tokens?: number }> = [];
  let callIndex = 0;

  const text = await callClaudeMessages({
    apiKey: "test-key",
    modelId: "claude-haiku-5-5",
    maxTokens: 4096,
    system: "sys",
    messages: [{ role: "user", content: "週次要約を実行して" }],
    mcpServers: buildMcpServerDefinitions({ domains: ["obsidian", "line", "usage"], authToken: "mcp-secret" }),
    functionName: "weekly",
    errorPrefix: "Claude MCP failed",
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(String(options?.body ?? "{}")) as {
        messages: Array<{ role: string; content: unknown }>;
      };
      requests.push({ messages: body.messages });
      callIndex++;
      if (callIndex === 1) {
        return new Response(
          JSON.stringify({
            model: "claude-haiku-5-5",
            stop_reason: "pause_turn",
            usage: { input_tokens: 100, output_tokens: 50 },
            content: [{ type: "mcp_tool_use", id: "tool_1", name: "obsidian_list_notes" }],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          model: "claude-haiku-5-5",
          stop_reason: "end_turn",
          usage: { input_tokens: 120, output_tokens: 30 },
          content: [{ type: "text", text: "要約とLINE通知を完了しました" }],
        }),
        { status: 200 },
      );
    },
    recordUsage: async (entry) => {
      usages.push(entry.usage as { input_tokens?: number; output_tokens?: number });
    },
  });

  expect(text).toBe("要約とLINE通知を完了しました");
  expect(requests).toHaveLength(2);
  expect(requests[1].messages).toEqual([
    { role: "user", content: "週次要約を実行して" },
    { role: "assistant", content: [{ type: "mcp_tool_use", id: "tool_1", name: "obsidian_list_notes" }] },
  ]);
  expect(usages).toEqual([
    { input_tokens: 100, output_tokens: 50 },
    { input_tokens: 120, output_tokens: 30 },
  ]);
});

test("callClaudeMessages は pause_turn が上限を超えると例外を投げる", async () => {
  await expect(
    callClaudeMessages({
      apiKey: "test-key",
      modelId: "claude-haiku-5-5",
      maxTokens: 4096,
      system: "sys",
      messages: [{ role: "user", content: "hello" }],
      functionName: "weekly",
      errorPrefix: "Claude MCP failed",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            model: "claude-haiku-5-5",
            stop_reason: "pause_turn",
            usage: { input_tokens: 10, output_tokens: 5 },
            content: [],
          }),
          { status: 200 },
        ),
      recordUsage: async () => {},
    }),
  ).rejects.toThrow("Claude MCP failed: exceeded max pause_turn continuations");
});

const TEST_WIF = {
  federationRuleId: "fdrl_test",
  organizationId: "org_test",
  serviceAccountId: "svac_test",
  workspaceId: "wrkspc_test",
};

test("exchangeWifToken は STS トークンを Anthropic OAuth トークンへ交換する", async () => {
  const tokenRequests: Array<{ url: string; body: Record<string, unknown> }> = [];
  let stsInput: unknown;

  const token = await exchangeWifToken({
    wif: TEST_WIF,
    stsClient: {
      send: async (command) => {
        stsInput = command.input;
        return { WebIdentityToken: "aws-jwt-123" };
      },
    },
    fetchImpl: async (url, options) => {
      tokenRequests.push({
        url: String(url),
        body: JSON.parse(String(options?.body ?? "{}")),
      });
      return new Response(JSON.stringify({ access_token: "sk-ant-oat01-test" }), { status: 200 });
    },
  });

  expect(token).toBe("sk-ant-oat01-test");
  expect(stsInput).toEqual({
    Audience: ["https://api.anthropic.com"],
    SigningAlgorithm: "RS256",
    DurationSeconds: 900,
  });
  expect(tokenRequests).toEqual([
    {
      url: "https://api.anthropic.com/v1/oauth/token",
      body: {
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: "aws-jwt-123",
        federation_rule_id: "fdrl_test",
        organization_id: "org_test",
        service_account_id: "svac_test",
        workspace_id: "wrkspc_test",
      },
    },
  ]);
});

test("resolveAnthropicAuth と callClaudeMessages は WIF 設定時に Bearer 認証と oauth beta を使用する", async () => {
  const requests: Array<{ url: string; headers: Headers }> = [];
  const auth = await resolveAnthropicAuth({
    apiKey: "sk-ant-unused",
    wif: TEST_WIF,
    stsClient: {
      send: async () => ({ WebIdentityToken: "aws-jwt-456" }),
    },
    fetchImpl: async (url) => {
      requests.push({ url: String(url), headers: new Headers() });
      return new Response(JSON.stringify({ access_token: "sk-ant-oat01-bearer" }), { status: 200 });
    },
  });

  expect(auth).toEqual({ type: "oauth", accessToken: "sk-ant-oat01-bearer" });

  const text = await callClaudeMessages({
    auth,
    modelId: "claude-haiku-5-5",
    maxTokens: 1024,
    system: "sys",
    messages: [{ role: "user", content: "hi" }],
    mcpServers: buildMcpServerDefinitions({ domains: ["obsidian"], authToken: "mcp-1" }),
    functionName: "weekly",
    errorPrefix: "Claude WIF failed",
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), headers: new Headers(options?.headers) });
      return new Response(
        JSON.stringify({
          model: "claude-haiku-5-5",
          usage: { input_tokens: 5, output_tokens: 2 },
          content: [{ type: "text", text: "ok" }],
        }),
        { status: 200 },
      );
    },
    recordUsage: async () => {},
  });

  expect(text).toBe("ok");
  expect(requests[1].url).toBe("https://api.anthropic.com/v1/messages");
  expect(requests[1].headers.get("authorization")).toBe("Bearer sk-ant-oat01-bearer");
  expect(requests[1].headers.get("x-api-key")).toBeNull();
  expect(requests[1].headers.get("anthropic-beta")).toBe("oauth-2025-04-20,mcp-client-2025-11-20");
});

test("settingsFromEnv は WIF 環境変数が揃っている場合に anthropicWif を構築し、一部欠落時は拒否する", () => {
  const withWif = settingsFromEnv({
    ANTHROPIC_FEDERATION_RULE_ID: "fdrl_1",
    ANTHROPIC_ORGANIZATION_ID: "org_1",
    ANTHROPIC_SERVICE_ACCOUNT_ID: "svac_1",
    ANTHROPIC_WORKSPACE_ID: "wrkspc_1",
  });
  expect(withWif.anthropicWif).toEqual({
    federationRuleId: "fdrl_1",
    organizationId: "org_1",
    serviceAccountId: "svac_1",
    workspaceId: "wrkspc_1",
  });

  expect(() =>
    settingsFromEnv({
      ANTHROPIC_FEDERATION_RULE_ID: "fdrl_1",
    }),
  ).toThrow(/must all be set together/);
});
