import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { summaryPrompt } from "./summary-prompt.js";
import {
  ANTHROPIC_API_VERSION,
  CLAUDE_API_URL,
  DEFAULT_BEDROCK_MODEL_ID,
  DEFAULT_CLAUDE_WEEKLY_MODEL_ID,
  DEFAULT_TRANSCRIPTION_PROVIDER,
  JSON_CONTENT_TYPE,
  MAX_SUMMARY_TOKENS,
} from "./const.js";

function textFromClaude(payload) {
  return (payload.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

function textFromBedrock(response) {
  return (response.output?.message?.content ?? []).map((block) => block.text ?? "").join("");
}

function requireSummary(text) {
  if (String(text).trim() === "") throw new Error("Summary was empty");
  return text;
}

export function createClaudeSummarizer({
  apiKey,
  modelId = DEFAULT_CLAUDE_WEEKLY_MODEL_ID,
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) throw new Error("Anthropic API key is required");
  return async function summarize(notesText) {
    const response = await fetchImpl(CLAUDE_API_URL, {
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
        messages: [{ role: "user", content: summaryPrompt(notesText) }],
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      const detail = payload.error?.message ?? response.statusText;
      throw new Error(`Claude summary failed: ${response.status} ${detail}`);
    }
    return requireSummary(textFromClaude(payload));
  };
}

export function createBedrockSummarizer({
  region,
  modelId = DEFAULT_BEDROCK_MODEL_ID,
  client = new BedrockRuntimeClient({ region }),
} = {}) {
  return async function summarize(notesText) {
    const response = await client.send(
      new ConverseCommand({
        modelId,
        messages: [{ role: "user", content: [{ text: summaryPrompt(notesText) }] }],
        inferenceConfig: { maxTokens: MAX_SUMMARY_TOKENS, temperature: 0 },
      }),
    );
    return requireSummary(textFromBedrock(response));
  };
}

export function createSummarizer({ provider = DEFAULT_TRANSCRIPTION_PROVIDER, claude: claudeOptions, bedrock: bedrockOptions }) {
  if (provider === "bedrock") return createBedrockSummarizer(bedrockOptions);
  if (provider === "claude") return createClaudeSummarizer(claudeOptions);
  throw new Error(`Unknown transcription provider: ${provider}`);
}
