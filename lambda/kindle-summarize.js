import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { assertImageSize } from "./transcribe/parse.js";
import { maxImageBytes } from "./transcribe/claude.js";
import { KINDLE_SYSTEM_PROMPT, KINDLE_USER_PROMPT } from "./kindle-prompt.js";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_CLAUDE_MODEL_ID = "claude-sonnet-5-5";
const DEFAULT_BEDROCK_MODEL_ID = "amazon.nova-lite-v1:0";
const MAX_TOKENS = 2048;

function mediaType(mimeType) {
  if (mimeType === "image/png") return "image/png";
  if (mimeType === "image/jpeg") return "image/jpeg";
  throw new Error(`Unsupported image type: ${mimeType}`);
}

function imageFormat(mimeType) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpeg";
  throw new Error(`Unsupported image type: ${mimeType}`);
}

function requireSummary(text) {
  if (String(text).trim() === "") throw new Error("Kindle summary was empty");
  return text;
}

function textFromClaude(payload) {
  return (payload.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

function textFromBedrock(response) {
  return (response.output?.message?.content ?? []).map((block) => block.text ?? "").join("");
}

export function createClaudeKindleSummarizer({
  apiKey,
  modelId = DEFAULT_CLAUDE_MODEL_ID,
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) throw new Error("Anthropic API key is required");
  return async function summarizeImage({ bytes, mimeType }) {
    assertImageSize(bytes, maxImageBytes);
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
    });
    const payload = await response.json();
    if (!response.ok) {
      const detail = payload.error?.message ?? response.statusText;
      throw new Error(`Claude kindle summary failed: ${response.status} ${detail}`);
    }
    return requireSummary(textFromClaude(payload));
  };
}

export function createBedrockKindleSummarizer({
  region,
  modelId = DEFAULT_BEDROCK_MODEL_ID,
  client = new BedrockRuntimeClient({ region }),
} = {}) {
  return async function summarizeImage({ bytes, mimeType }) {
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
        inferenceConfig: { maxTokens: MAX_TOKENS, temperature: 0 },
      }),
    );
    return requireSummary(textFromBedrock(response));
  };
}

export function createKindleSummarizer({
  provider = "claude",
  claude: claudeOptions,
  bedrock: bedrockOptions,
}) {
  if (provider === "bedrock") return createBedrockKindleSummarizer(bedrockOptions);
  if (provider === "claude") return createClaudeKindleSummarizer(claudeOptions);
  throw new Error(`Unknown transcription provider: ${provider}`);
}
