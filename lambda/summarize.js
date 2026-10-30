import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { summaryPrompt } from "./summary-prompt.js";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_CLAUDE_MODEL_ID = "claude-haiku-5-5";
const DEFAULT_BEDROCK_MODEL_ID = "amazon.nova-lite-v1:0";
const MAX_TOKENS = 2048;

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
  modelId = DEFAULT_CLAUDE_MODEL_ID,
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) throw new Error("Anthropic API key is required");
  return async function summarize(notesText) {
    const response = await fetchImpl(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: MAX_TOKENS,
        thinking: { type: "disabled" },
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
        inferenceConfig: { maxTokens: MAX_TOKENS, temperature: 0 },
      }),
    );
    return requireSummary(textFromBedrock(response));
  };
}

export function createSummarizer({ provider = "claude", claude: claudeOptions, bedrock: bedrockOptions }) {
  if (provider === "bedrock") return createBedrockSummarizer(bedrockOptions);
  if (provider === "claude") return createClaudeSummarizer(claudeOptions);
  throw new Error(`Unknown transcription provider: ${provider}`);
}
