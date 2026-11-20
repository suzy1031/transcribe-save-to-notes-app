import { recordWeeklyUsage } from "../claude/claude-usage.ts";
import {
  DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID,
  MAX_IMAGE_BYTES,
  MAX_TRANSCRIPTION_TOKENS,
  TRANSCRIBE_USER_PROMPT,
} from "../shared/const.ts";
import { callClaudeMessages, imageMediaType, requireAnthropicApiKey } from "../shared/llm.ts";
import { assertImageSize, parseTranscription } from "./parse.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import type { ClaudeTranscriberOptions, ParsedTranscription, TranscribeInput } from "./types.ts";

export { MAX_IMAGE_BYTES as maxImageBytes };

export function createTranscriber({
  apiKey,
  modelId = DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID,
  fetchImpl = fetch,
  recordUsage = recordWeeklyUsage,
}: ClaudeTranscriberOptions = {}): (input: TranscribeInput) => Promise<ParsedTranscription> {
  const verifiedApiKey = requireAnthropicApiKey(apiKey);
  return async function transcribe({ bytes, mimeType }: TranscribeInput): Promise<ParsedTranscription> {
    assertImageSize(bytes, MAX_IMAGE_BYTES);
    const text = await callClaudeMessages({
      apiKey: verifiedApiKey,
      modelId,
      maxTokens: MAX_TRANSCRIPTION_TOKENS,
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
                media_type: imageMediaType(mimeType),
                data: Buffer.from(bytes).toString("base64"),
              },
            },
            { type: "text", text: TRANSCRIBE_USER_PROMPT },
          ],
        },
      ],
      functionName: "index",
      errorPrefix: "Claude transcription failed",
      fetchImpl,
      recordUsage,
    });
    return parseTranscription(text);
  };
}
