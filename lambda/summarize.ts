import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { recordWeeklyUsage } from "./claude-usage.ts";
import { SUMMARY_SYSTEM_PROMPT, wrapSummaryNotes } from "./summary-prompt.ts";
import {
  ANTHROPIC_API_VERSION,
  CLAUDE_API_URL,
  DEFAULT_BEDROCK_MODEL_ID,
  DEFAULT_CLAUDE_WEEKLY_MODEL_ID,
  DEFAULT_TRANSCRIPTION_PROVIDER,
  JSON_CONTENT_TYPE,
  MAX_SUMMARY_TOKENS,
} from "./const.ts";
import { withFetchTimeout } from "./fetch-with-timeout.ts";
import { sanitizeErrorMessage } from "./sanitize-error.ts";
import type { BedrockSummarizerOptions, ClaudeSummarizerOptions } from "./types/summarize.ts";

function textFromClaude(payload: any): string {
  return (payload.content ?? [])
    .filter((block: any) => block.type === "text")
    .map((block: any) => block.text ?? "")
    .join("");
}

function textFromBedrock(response: any): string {
  return (response.output?.message?.content ?? []).map((block: any) => block.text ?? "").join("");
}

function requireSummary(text: string): string {
  if (String(text).trim() === "") throw new Error("Summary was empty");
  return text;
}

export function createClaudeSummarizer({
  apiKey,
  modelId = DEFAULT_CLAUDE_WEEKLY_MODEL_ID,
  fetchImpl = fetch,
  recordUsage = recordWeeklyUsage,
}: ClaudeSummarizerOptions = {}): (notesText: string) => Promise<string> {
  if (!apiKey) throw new Error("Anthropic API key is required");
  return async function summarize(notesText: string): Promise<string> {
    const userContent = wrapSummaryNotes(notesText);
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
          system: SUMMARY_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userContent }],
        }),
      }),
    );
    const payload = (await response.json()) as any;
    if (!response.ok) {
      const detail = sanitizeErrorMessage(payload.error?.message ?? response.statusText);
      throw new Error(`Claude summary failed: ${response.status} ${detail}`);
    }
    await recordUsage({
      functionName: "weekly",
      modelId: payload.model || modelId,
      usage: payload.usage ?? {},
    });
    return requireSummary(textFromClaude(payload));
  };
}

export function createBedrockSummarizer({
  region,
  modelId = DEFAULT_BEDROCK_MODEL_ID,
  client = new BedrockRuntimeClient({ region }),
}: BedrockSummarizerOptions = {}): (notesText: string) => Promise<string> {
  return async function summarize(notesText: string): Promise<string> {
    const response = await client.send(
      new ConverseCommand({
        modelId,
        system: [{ text: SUMMARY_SYSTEM_PROMPT }],
        messages: [{ role: "user", content: [{ text: wrapSummaryNotes(notesText) }] }],
        inferenceConfig: { maxTokens: MAX_SUMMARY_TOKENS, temperature: 0 },
      }),
    );
    return requireSummary(textFromBedrock(response));
  };
}

export function createSummarizer({
  provider = DEFAULT_TRANSCRIPTION_PROVIDER,
  claude: claudeOptions,
  bedrock: bedrockOptions,
}: {
  provider?: string;
  claude?: ClaudeSummarizerOptions;
  bedrock?: BedrockSummarizerOptions;
}): (notesText: string) => Promise<string> {
  if (provider === "bedrock") return createBedrockSummarizer(bedrockOptions);
  if (provider === "claude") return createClaudeSummarizer(claudeOptions);
  throw new Error(`Unknown transcription provider: ${provider}`);
}
