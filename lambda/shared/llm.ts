import { recordWeeklyUsage } from "../claude/claude-usage.ts";
import type { RawClaudeUsage, RecordWeeklyUsageOptions } from "../claude/types.ts";
import {
  ANTHROPIC_API_VERSION,
  ANTHROPIC_MCP_BETA_HEADER,
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

export interface ClaudeMessagesRequest {
  apiKey: string;
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

/** Call Anthropic Messages API, record token usage, and return concatenated text blocks. */
export async function callClaudeMessages({
  apiKey,
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
  const hasMcp = Array.isArray(mcpServers) && mcpServers.length > 0;
  const resolvedTools = hasMcp
    ? (tools ?? mcpServers.map((server) => ({ type: "mcp_toolset" as const, mcp_server_name: server.name })))
    : tools;
  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: maxTokens,
    ...(thinking ? { thinking } : {}),
    ...(hasMcp ? { mcp_servers: mcpServers } : {}),
    ...(resolvedTools && resolvedTools.length > 0 ? { tools: resolvedTools } : {}),
    system,
    messages,
  };
  const headers: Record<string, string> = {
    "content-type": JSON_CONTENT_TYPE,
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_API_VERSION,
    ...(hasMcp ? { "anthropic-beta": (mcpBetas ?? [ANTHROPIC_MCP_BETA_HEADER]).join(",") } : {}),
  };
  const requestTimeoutMs = timeoutMs ?? (hasMcp ? CLAUDE_MCP_FETCH_TIMEOUT_MS : EXTERNAL_API_FETCH_TIMEOUT_MS);
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
  return extractClaudeText(payload);
}
