import { ConverseCommand, type ConverseCommandInput } from "@aws-sdk/client-bedrock-runtime";
import { recordWeeklyUsage } from "../claude/claude-usage.ts";
import type { RawClaudeUsage, RecordWeeklyUsageOptions } from "../claude/types.ts";
import type { BedrockClientLike } from "../transcribe/types.ts";
import { ANTHROPIC_API_VERSION, CLAUDE_API_URL, IMAGE_MIME_JPEG, IMAGE_MIME_PNG, JSON_CONTENT_TYPE } from "./const.ts";
import { withFetchTimeout } from "./fetch-with-timeout.ts";
import { sanitizeErrorMessage } from "./sanitize-error.ts";

export type ImageMimeType = typeof IMAGE_MIME_PNG | typeof IMAGE_MIME_JPEG;
export type BedrockImageFormat = "png" | "jpeg";

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

export interface ClaudeMessagesRequest {
  apiKey: string;
  modelId: string;
  maxTokens: number;
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: unknown }>;
  thinking?: { type: string };
  functionName: string;
  errorPrefix: string;
  fetchImpl?: typeof fetch;
  recordUsage?: (options: RecordWeeklyUsageOptions) => Promise<unknown>;
}

export interface BedrockConverseResponse {
  output?: {
    message?: {
      content?: Array<{ text?: string }>;
    };
  };
}

export interface BedrockConverseRequest {
  client: BedrockClientLike;
  modelId: string;
  maxTokens: number;
  system: string;
  messages: NonNullable<ConverseCommandInput["messages"]>;
  temperature?: number;
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

/** Convert a supported image MIME type to the Bedrock Converse image format string. */
export function bedrockImageFormat(mimeType?: string): BedrockImageFormat {
  return imageMediaType(mimeType) === IMAGE_MIME_PNG ? "png" : "jpeg";
}

/** Concatenate text blocks from a Claude Messages API response. */
export function extractClaudeText(payload: ClaudeMessagesResponse): string {
  return (payload.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

/** Concatenate text blocks from a Bedrock Converse API response. */
export function extractBedrockText(response: BedrockConverseResponse): string {
  return (response.output?.message?.content ?? []).map((block) => block.text ?? "").join("");
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
  functionName,
  errorPrefix,
  fetchImpl = fetch,
  recordUsage = recordWeeklyUsage,
}: ClaudeMessagesRequest): Promise<string> {
  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: maxTokens,
    ...(thinking ? { thinking } : {}),
    system,
    messages,
  };
  const response = await fetchImpl(
    CLAUDE_API_URL,
    withFetchTimeout({
      method: "POST",
      headers: {
        "content-type": JSON_CONTENT_TYPE,
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify(body),
    }),
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

/** Call Bedrock Converse API and return concatenated text blocks. */
export async function converseBedrock({
  client,
  modelId,
  maxTokens,
  system,
  messages,
  temperature = 0,
}: BedrockConverseRequest): Promise<string> {
  const response = (await client.send(
    new ConverseCommand({
      modelId,
      system: [{ text: system }],
      messages,
      inferenceConfig: { maxTokens, temperature },
    }),
  )) as BedrockConverseResponse;
  return extractBedrockText(response);
}
