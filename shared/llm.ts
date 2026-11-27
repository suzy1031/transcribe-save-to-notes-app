import { GetWebIdentityTokenCommand, STSClient } from "@aws-sdk/client-sts";
import type { RawClaudeUsage, RecordWeeklyUsageOptions } from "../interfaces/claude.ts";
import type { AnthropicWifConfig } from "../interfaces/shared.ts";
import { recordWeeklyUsage } from "./claude/claude-usage.ts";
import {
  ANTHROPIC_API_VERSION,
  ANTHROPIC_MCP_BETA_HEADER,
  ANTHROPIC_OAUTH_BETA_HEADER,
  ANTHROPIC_OAUTH_TOKEN_URL,
  ANTHROPIC_WIF_AUDIENCE,
  ANTHROPIC_WIF_STS_REGION,
  ANTHROPIC_WIF_TOKEN_DURATION_SECONDS,
  CLAUDE_API_URL,
  CLAUDE_MCP_FETCH_TIMEOUT_MS,
  DEFAULT_MCP_DOMAIN_NAME,
  EXTERNAL_API_FETCH_TIMEOUT_MS,
  IMAGE_MIME_JPEG,
  IMAGE_MIME_PNG,
  JSON_CONTENT_TYPE,
} from "./const.ts";
import { withFetchTimeout } from "./fetch-with-timeout.ts";
import { sanitizeErrorMessage } from "./sanitize-error.ts";

export type ImageMimeType = typeof IMAGE_MIME_PNG | typeof IMAGE_MIME_JPEG;

export interface ClaudeTextBlock {
  type?: string;
  text?: string;
}

export interface ClaudeMessagesResponse {
  model?: string;
  stop_reason?: string | null;
  usage?: RawClaudeUsage;
  content?: ClaudeTextBlock[];
  error?: {
    message?: string;
  };
}

export interface ClaudeMcpServerDefinition {
  type: "url";
  url: string;
  name: string;
  authorization_token?: string;
}

export interface ClaudeMcpToolset {
  type: "mcp_toolset";
  mcp_server_name: string;
  default_config?: {
    enabled?: boolean;
    defer_loading?: boolean;
  };
  configs?: Record<string, { enabled?: boolean; defer_loading?: boolean }>;
}

export type McpDomainName = "obsidian" | "drive" | "csv" | "line" | "usage";

const MCP_SERVER_NAMES: Record<McpDomainName, string> = {
  obsidian: "obsidian-s3",
  drive: "google-drive",
  csv: "household-csv",
  line: "line-notification",
  usage: "claude-usage",
};

/**
 * ドメイン名と Bearer トークンから Claude Messages API `mcp_servers` 定義配列を生成する。
 * @param options 対象ドメイン一覧・ルートドメイン・認証トークン
 * @returns `ClaudeMcpServerDefinition` の配列
 */
export function buildMcpServerDefinitions({
  domains,
  authToken,
  rootDomain = DEFAULT_MCP_DOMAIN_NAME,
}: {
  domains: ReadonlyArray<McpDomainName>;
  authToken?: string;
  rootDomain?: string;
}): ClaudeMcpServerDefinition[] {
  const token = (authToken ?? "").trim();
  return domains.map((domain) => ({
    type: "url",
    url: `https://${domain}.${rootDomain}/`,
    name: MCP_SERVER_NAMES[domain],
    ...(token ? { authorization_token: token } : {}),
  }));
}

export interface StsClientLike {
  send(command: GetWebIdentityTokenCommand): Promise<{ WebIdentityToken?: string }>;
}

export type AnthropicAuth = { type: "apiKey"; apiKey: string } | { type: "oauth"; accessToken: string };

export interface ClaudeMessagesRequest {
  apiKey?: string;
  wif?: AnthropicWifConfig;
  auth?: AnthropicAuth;
  stsClient?: StsClientLike;
  modelId: string;
  maxTokens: number;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
  thinking?: { type: string };
  mcpServers?: ReadonlyArray<ClaudeMcpServerDefinition>;
  tools?: ReadonlyArray<ClaudeMcpToolset>;
  mcpBetas?: ReadonlyArray<string>;
  timeoutMs?: number;
  functionName: string;
  errorPrefix: string;
  fetchImpl?: typeof fetch;
  recordUsage?: (options: RecordWeeklyUsageOptions) => Promise<unknown>;
}

/** Validate that an Anthropic API key is present before constructing a client. */
export function requireAnthropicApiKey(apiKey?: string): string {
  if (!apiKey) throw new Error("Anthropic API key is required");
  return apiKey;
}

/** Exchange an AWS STS Web Identity Token for a short-lived Anthropic OAuth access token. */
export async function exchangeWifToken({
  wif,
  stsClient = new STSClient({ region: ANTHROPIC_WIF_STS_REGION }),
  fetchImpl = fetch,
}: {
  wif: AnthropicWifConfig;
  stsClient?: StsClientLike;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const stsResponse = await stsClient.send(
    new GetWebIdentityTokenCommand({
      Audience: [ANTHROPIC_WIF_AUDIENCE],
      SigningAlgorithm: "RS256",
      DurationSeconds: ANTHROPIC_WIF_TOKEN_DURATION_SECONDS,
    }),
  );
  const jwt = stsResponse.WebIdentityToken;
  if (!jwt) {
    throw new Error("AWS STS did not return WebIdentityToken");
  }

  const response = await fetchImpl(
    ANTHROPIC_OAUTH_TOKEN_URL,
    withFetchTimeout(
      {
        method: "POST",
        headers: { "content-type": JSON_CONTENT_TYPE },
        body: JSON.stringify({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: jwt,
          federation_rule_id: wif.federationRuleId,
          organization_id: wif.organizationId,
          service_account_id: wif.serviceAccountId,
          workspace_id: wif.workspaceId,
        }),
      },
      EXTERNAL_API_FETCH_TIMEOUT_MS,
    ),
  );
  const payload = (await response.json()) as {
    access_token?: string;
    error?: string | { message?: string };
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    const rawDetail =
      payload.error_description ??
      (typeof payload.error === "string" ? payload.error : payload.error?.message) ??
      response.statusText;
    const detail = sanitizeErrorMessage(rawDetail);
    throw new Error(`Anthropic WIF token exchange failed: ${response.status} ${detail}`);
  }
  return payload.access_token;
}

/** Resolve Claude API authentication, preferring AWS Workload Identity Federation when configured. */
export async function resolveAnthropicAuth({
  apiKey,
  wif,
  stsClient,
  fetchImpl = fetch,
}: {
  apiKey?: string;
  wif?: AnthropicWifConfig;
  stsClient?: StsClientLike;
  fetchImpl?: typeof fetch;
}): Promise<AnthropicAuth> {
  if (wif) {
    return {
      type: "oauth",
      accessToken: await exchangeWifToken({ wif, stsClient, fetchImpl }),
    };
  }
  return { type: "apiKey", apiKey: requireAnthropicApiKey(apiKey) };
}

/** Validate and normalize an image MIME type for Claude Messages API. */
export function imageMediaType(mimeType?: string): ImageMimeType {
  if (mimeType === IMAGE_MIME_PNG) return IMAGE_MIME_PNG;
  if (mimeType === IMAGE_MIME_JPEG) return IMAGE_MIME_JPEG;
  throw new Error(`Unsupported image type: ${mimeType}`);
}

/** Concatenate text blocks from a Claude Messages API response. */
export function extractClaudeText(payload: ClaudeMessagesResponse): string {
  return (payload.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

/** Throw when an LLM response is empty or whitespace-only. */
export function requireNonEmptyText(text: string, errorMessage: string): string {
  if (String(text).trim() === "") throw new Error(errorMessage);
  return text;
}

const MAX_PAUSE_TURN_CONTINUATIONS = 10;

/** Call Anthropic Messages API, continuing `pause_turn` responses, record token usage, and return concatenated text blocks. */
export async function callClaudeMessages({
  apiKey,
  wif,
  auth,
  stsClient,
  modelId,
  maxTokens,
  system,
  messages,
  thinking,
  mcpServers,
  tools,
  mcpBetas,
  timeoutMs,
  functionName,
  errorPrefix,
  fetchImpl = fetch,
  recordUsage = recordWeeklyUsage,
}: ClaudeMessagesRequest): Promise<string> {
  const resolvedAuth = auth ?? (await resolveAnthropicAuth({ apiKey, wif, stsClient, fetchImpl }));
  const hasMcp = Array.isArray(mcpServers) && mcpServers.length > 0;
  const resolvedTools = hasMcp
    ? (tools ?? mcpServers.map((server) => ({ type: "mcp_toolset" as const, mcp_server_name: server.name })))
    : tools;
  const betaHeaders = [
    ...(resolvedAuth.type === "oauth" ? [ANTHROPIC_OAUTH_BETA_HEADER] : []),
    ...(hasMcp ? (mcpBetas ?? [ANTHROPIC_MCP_BETA_HEADER]) : []),
  ];
  const headers: Record<string, string> = {
    "content-type": JSON_CONTENT_TYPE,
    ...(resolvedAuth.type === "oauth"
      ? { authorization: `Bearer ${resolvedAuth.accessToken}` }
      : { "x-api-key": resolvedAuth.apiKey }),
    "anthropic-version": ANTHROPIC_API_VERSION,
    ...(betaHeaders.length > 0 ? { "anthropic-beta": betaHeaders.join(",") } : {}),
  };
  const requestTimeoutMs = timeoutMs ?? (hasMcp ? CLAUDE_MCP_FETCH_TIMEOUT_MS : EXTERNAL_API_FETCH_TIMEOUT_MS);

  let currentMessages = [...messages];
  const textParts: string[] = [];

  for (let turn = 0; ; turn++) {
    const body: Record<string, unknown> = {
      model: modelId,
      max_tokens: maxTokens,
      ...(thinking ? { thinking } : {}),
      ...(hasMcp ? { mcp_servers: mcpServers } : {}),
      ...(resolvedTools && resolvedTools.length > 0 ? { tools: resolvedTools } : {}),
      system,
      messages: currentMessages,
    };
    const response = await fetchImpl(
      CLAUDE_API_URL,
      withFetchTimeout(
        {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        },
        requestTimeoutMs,
      ),
    );
    const payload = (await response.json()) as ClaudeMessagesResponse;
    if (!response.ok) {
      const detail = sanitizeErrorMessage(payload.error?.message ?? response.statusText);
      throw new Error(`${errorPrefix}: ${response.status} ${detail}`);
    }
    await recordUsage({
      functionName,
      modelId: payload.model || modelId,
      usage: payload.usage ?? {},
    });
    textParts.push(extractClaudeText(payload));
    if (payload.stop_reason !== "pause_turn") {
      return textParts.join("");
    }
    if (turn >= MAX_PAUSE_TURN_CONTINUATIONS) {
      throw new Error(`${errorPrefix}: exceeded max pause_turn continuations`);
    }
    currentMessages = [...currentMessages, { role: "assistant", content: payload.content ?? [] }];
  }
}
