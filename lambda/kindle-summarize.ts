import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { recordWeeklyUsage, type RecordWeeklyUsageOptions } from "./claude-usage.ts";
import { assertImageSize } from "./transcribe/parse.ts";
import { maxImageBytes, type TranscribeInput } from "./transcribe/claude.ts";
import type { BedrockClientLike } from "./transcribe/bedrock.ts";
import { KINDLE_SYSTEM_PROMPT, KINDLE_USER_PROMPT } from "./kindle-prompt.ts";
import {
  ANTHROPIC_API_VERSION,
  CLAUDE_API_URL,
  DEFAULT_BEDROCK_MODEL_ID,
  DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID,
  DEFAULT_TRANSCRIPTION_PROVIDER,
  JSON_CONTENT_TYPE,
  MAX_SUMMARY_TOKENS,
} from "./const.ts";
import { withFetchTimeout } from "./fetch-with-timeout.ts";
import { sanitizeErrorMessage } from "./sanitize-error.ts";

export interface ClaudeKindleSummarizerOptions {
  apiKey?: string;
  modelId?: string;
  fetchImpl?: typeof fetch;
  recordUsage?: (options: RecordWeeklyUsageOptions) => Promise<unknown>;
}

export interface BedrockKindleSummarizerOptions {
  region?: string;
  modelId?: string;
  client?: BedrockClientLike;
}

function mediaType(mimeType?: string): "image/png" | "image/jpeg" {
  if (mimeType === "image/png") return "image/png";
  if (mimeType === "image/jpeg") return "image/jpeg";
  throw new Error(`Unsupported image type: ${mimeType}`);
}

function imageFormat(mimeType?: string): "png" | "jpeg" {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpeg";
  throw new Error(`Unsupported image type: ${mimeType}`);
}

function requireSummary(text: string): string {
  if (String(text).trim() === "") throw new Error("Kindle summary was empty");
  return text;
}

function textFromClaude(payload: any): string {
  return (payload.content ?? [])
    .filter((block: any) => block.type === "text")
    .map((block: any) => block.text ?? "")
    .join("");
}

function textFromBedrock(response: any): string {
  return (response.output?.message?.content ?? []).map((block: any) => block.text ?? "").join("");
}

export function createClaudeKindleSummarizer({
  apiKey,
  modelId = DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID,
  fetchImpl = fetch,
  recordUsage = recordWeeklyUsage,
}: ClaudeKindleSummarizerOptions = {}): (input: TranscribeInput) => Promise<string> {
  if (!apiKey) throw new Error("Anthropic API key is required");
  return async function summarizeImage({ bytes, mimeType }: TranscribeInput): Promise<string> {
    assertImageSize(bytes, maxImageBytes);
    const response = await fetchImpl(
      CLAUDE_API_URL,
      withFetchTimeout({
        method: "POST",
        headers: {
          "content-type": JSON_CONTENT_TYPE,
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_API_VERSION,
        },
        body: JSON.stringify({
          model: modelId,
          max_tokens: MAX_SUMMARY_TOKENS,
          thinking: { type: "between_tools" },
          system: KINDLE_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: mediaType(mimeType),
                    data: Buffer.from(bytes).toString("base64"),
                  },
                },
                { type: "text", text: KINDLE_USER_PROMPT },
              ],
            },
          ],
        }),
      }),
    );
    const payload = (await response.json()) as any;
    if (!response.ok) {
      const detail = sanitizeErrorMessage(payload.error?.message ?? response.statusText);
      throw new Error(`Claude kindle summary failed: ${response.status} ${detail}`);
    }
    await recordUsage({
      functionName: "kindle",
      modelId: payload.model || modelId,
      usage: payload.usage ?? {},
    });
    return requireSummary(textFromClaude(payload));
  };
}

export function createBedrockKindleSummarizer({
  region,
  modelId = DEFAULT_BEDROCK_MODEL_ID,
  client = new BedrockRuntimeClient({ region }),
}: BedrockKindleSummarizerOptions = {}): (input: TranscribeInput) => Promise<string> {
  return async function summarizeImage({ bytes, mimeType }: TranscribeInput): Promise<string> {
    assertImageSize(bytes, maxImageBytes);
    const response = await client.send(
      new ConverseCommand({
        modelId,
        system: [{ text: KINDLE_SYSTEM_PROMPT }],
        messages: [
          {
            role: "user",
            content: [
              { text: KINDLE_USER_PROMPT },
              {
                image: {
                  format: imageFormat(mimeType),
                  source: { bytes: Buffer.from(bytes) },
                },
              },
            ],
          },
        ],
        inferenceConfig: { maxTokens: MAX_SUMMARY_TOKENS, temperature: 0 },
      }),
    );
    return requireSummary(textFromBedrock(response));
  };
}

export function createKindleSummarizer({
  provider = DEFAULT_TRANSCRIPTION_PROVIDER,
  claude: claudeOptions,
  bedrock: bedrockOptions,
}: {
  provider?: string;
  claude?: ClaudeKindleSummarizerOptions;
  bedrock?: BedrockKindleSummarizerOptions;
}): (input: TranscribeInput) => Promise<string> {
  if (provider === "bedrock") return createBedrockKindleSummarizer(bedrockOptions);
  if (provider === "claude") return createClaudeKindleSummarizer(claudeOptions);
  throw new Error(`Unknown transcription provider: ${provider}`);
}
