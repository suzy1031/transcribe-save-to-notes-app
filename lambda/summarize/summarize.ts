import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { recordWeeklyUsage } from "../claude/claude-usage.ts";
import {
  DEFAULT_BEDROCK_MODEL_ID,
  DEFAULT_CLAUDE_WEEKLY_MODEL_ID,
  DEFAULT_TRANSCRIPTION_PROVIDER,
  MAX_SUMMARY_TOKENS,
} from "../shared/const.ts";
import { callClaudeMessages, converseBedrock, requireAnthropicApiKey, requireNonEmptyText } from "../shared/llm.ts";
import { SUMMARY_SYSTEM_PROMPT, wrapSummaryNotes } from "./summary-prompt.ts";
import type { BedrockSummarizerOptions, ClaudeSummarizerOptions } from "./types.ts";

export function createClaudeSummarizer({
  apiKey,
  modelId = DEFAULT_CLAUDE_WEEKLY_MODEL_ID,
  fetchImpl = fetch,
  recordUsage = recordWeeklyUsage,
}: ClaudeSummarizerOptions = {}): (notesText: string) => Promise<string> {
  const verifiedApiKey = requireAnthropicApiKey(apiKey);
  return async function summarize(notesText: string): Promise<string> {
    const text = await callClaudeMessages({
      apiKey: verifiedApiKey,
      modelId,
      maxTokens: MAX_SUMMARY_TOKENS,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: wrapSummaryNotes(notesText) }],
      functionName: "weekly",
      errorPrefix: "Claude summary failed",
      fetchImpl,
      recordUsage,
    });
    return requireNonEmptyText(text, "Summary was empty");
  };
}

export function createBedrockSummarizer({
  region,
  modelId = DEFAULT_BEDROCK_MODEL_ID,
  client = new BedrockRuntimeClient({ region }),
}: BedrockSummarizerOptions = {}): (notesText: string) => Promise<string> {
  return async function summarize(notesText: string): Promise<string> {
    const text = await converseBedrock({
      client,
      modelId,
      maxTokens: MAX_SUMMARY_TOKENS,
      system: SUMMARY_SYSTEM_PROMPT,
      messages: [{ role: "user", content: [{ text: wrapSummaryNotes(notesText) }] }],
    });
    return requireNonEmptyText(text, "Summary was empty");
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
