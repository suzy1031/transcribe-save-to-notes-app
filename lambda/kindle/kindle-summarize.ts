import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { recordWeeklyUsage } from "../claude/claude-usage.ts";
import {
  DEFAULT_BEDROCK_MODEL_ID,
  DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID,
  DEFAULT_TRANSCRIPTION_PROVIDER,
  MAX_SUMMARY_TOKENS,
} from "../shared/const.ts";
import {
  bedrockImageFormat,
  callClaudeMessages,
  converseBedrock,
  imageMediaType,
  requireAnthropicApiKey,
  requireNonEmptyText,
} from "../shared/llm.ts";
import { maxImageBytes } from "../transcribe/claude.ts";
import { assertImageSize } from "../transcribe/parse.ts";
import type { TranscribeInput } from "../transcribe/types.ts";
import { KINDLE_SYSTEM_PROMPT, KINDLE_USER_PROMPT } from "./kindle-prompt.ts";
import type { BedrockKindleSummarizerOptions, ClaudeKindleSummarizerOptions } from "./types.ts";

export function createClaudeKindleSummarizer({
  apiKey,
  modelId = DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID,
  fetchImpl = fetch,
  recordUsage = recordWeeklyUsage,
}: ClaudeKindleSummarizerOptions = {}): (input: TranscribeInput) => Promise<string> {
  const verifiedApiKey = requireAnthropicApiKey(apiKey);
  return async function summarizeImage({ bytes, mimeType }: TranscribeInput): Promise<string> {
    assertImageSize(bytes, maxImageBytes);
    const text = await callClaudeMessages({
      apiKey: verifiedApiKey,
      modelId,
      maxTokens: MAX_SUMMARY_TOKENS,
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
                media_type: imageMediaType(mimeType),
                data: Buffer.from(bytes).toString("base64"),
              },
            },
            { type: "text", text: KINDLE_USER_PROMPT },
          ],
        },
      ],
      functionName: "kindle",
      errorPrefix: "Claude kindle summary failed",
      fetchImpl,
      recordUsage,
    });
    return requireNonEmptyText(text, "Kindle summary was empty");
  };
}

export function createBedrockKindleSummarizer({
  region,
  modelId = DEFAULT_BEDROCK_MODEL_ID,
  client = new BedrockRuntimeClient({ region }),
}: BedrockKindleSummarizerOptions = {}): (input: TranscribeInput) => Promise<string> {
  return async function summarizeImage({ bytes, mimeType }: TranscribeInput): Promise<string> {
    assertImageSize(bytes, maxImageBytes);
    const text = await converseBedrock({
      client,
      modelId,
      maxTokens: MAX_SUMMARY_TOKENS,
      system: KINDLE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { text: KINDLE_USER_PROMPT },
            {
              image: {
                format: bedrockImageFormat(mimeType),
                source: { bytes: Buffer.from(bytes) },
              },
            },
          ],
        },
      ],
    });
    return requireNonEmptyText(text, "Kindle summary was empty");
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
