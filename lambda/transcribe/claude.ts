import { recordWeeklyUsage, type RecordWeeklyUsageOptions } from "../claude-usage.ts";
import { SYSTEM_PROMPT } from "../prompt.ts";
import { assertImageSize, parseTranscription, type ParsedTranscription } from "./parse.ts";
import {
  ANTHROPIC_API_VERSION,
  CLAUDE_API_URL,
  DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID,
  JSON_CONTENT_TYPE,
  MAX_IMAGE_BYTES,
  MAX_TRANSCRIPTION_TOKENS,
  TRANSCRIBE_USER_PROMPT,
} from "../const.ts";
import { withFetchTimeout } from "../fetch-with-timeout.ts";
import { sanitizeErrorMessage } from "../sanitize-error.ts";

export { MAX_IMAGE_BYTES as maxImageBytes };

export interface ClaudeTranscriberOptions {
  apiKey?: string;
  modelId?: string;
  fetchImpl?: typeof fetch;
  recordUsage?: (options: RecordWeeklyUsageOptions) => Promise<unknown>;
}

export interface TranscribeInput {
  bytes: Uint8Array | Buffer;
  mimeType?: string;
}

function mediaType(mimeType?: string): "image/png" | "image/jpeg" {
  if (mimeType === "image/png") return "image/png";
  if (mimeType === "image/jpeg") return "image/jpeg";
  throw new Error(`Unsupported image type: ${mimeType}`);
}

export function createTranscriber({
  apiKey,
  modelId = DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID,
  fetchImpl = fetch,
  recordUsage = recordWeeklyUsage,
}: ClaudeTranscriberOptions = {}): (input: TranscribeInput) => Promise<ParsedTranscription> {
  if (!apiKey) throw new Error("Anthropic API key is required");
  return async function transcribe({ bytes, mimeType }: TranscribeInput): Promise<ParsedTranscription> {
    assertImageSize(bytes, MAX_IMAGE_BYTES);
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
          max_tokens: MAX_TRANSCRIPTION_TOKENS,
          thinking: { type: "between_tools" },
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
                { type: "text", text: TRANSCRIBE_USER_PROMPT },
              ],
            },
          ],
        }),
      }),
    );
    const payload = (await response.json()) as any;
    if (!response.ok) {
      const detail = sanitizeErrorMessage(payload.error?.message ?? response.statusText);
      throw new Error(`Claude transcription failed: ${response.status} ${detail}`);
    }
    await recordUsage({
      functionName: "index",
      modelId: payload.model || modelId,
      usage: payload.usage ?? {},
    });
    const text = (payload.content ?? [])
      .filter((block: any) => block.type === "text")
      .map((block: any) => block.text ?? "")
      .join("");
    return parseTranscription(text);
  };
}
