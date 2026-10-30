import { SYSTEM_PROMPT } from "../prompt.js";
import { assertImageSize, parseTranscription } from "./parse.js";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL_ID = "claude-haiku-5-5";

export const maxImageBytes = 7 * 1024 * 1024;

function mediaType(mimeType) {
  if (mimeType === "image/png") return "image/png";
  if (mimeType === "image/jpeg") return "image/jpeg";
  throw new Error(`Unsupported image type: ${mimeType}`);
}

export function createTranscriber({
  apiKey,
  modelId = DEFAULT_MODEL_ID,
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) throw new Error("Anthropic API key is required");
  return async function transcribe({ bytes, mimeType }) {
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
        max_tokens: 4096,
        thinking: { type: "disabled" },
        system: SYSTEM_PROMPT,
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
              { type: "text", text: "この手書きノート画像を読み取ってください。" },
            ],
          },
        ],
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      const detail = payload.error?.message ?? response.statusText;
      throw new Error(`Claude transcription failed: ${response.status} ${detail}`);
    }
    const text = (payload.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");
    return parseTranscription(text);
  };
}
