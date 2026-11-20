import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import {
  DEFAULT_BEDROCK_MODEL_ID,
  MAX_IMAGE_BYTES,
  MAX_TRANSCRIPTION_TOKENS,
  TRANSCRIBE_USER_PROMPT,
} from "../shared/const.ts";
import { bedrockImageFormat, converseBedrock } from "../shared/llm.ts";
import { assertImageSize, parseTranscription } from "./parse.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import type { BedrockTranscriberOptions, ParsedTranscription, TranscribeInput } from "./types.ts";

export { MAX_IMAGE_BYTES as maxImageBytes };

export function createTranscriber({
  region,
  modelId = DEFAULT_BEDROCK_MODEL_ID,
  client = new BedrockRuntimeClient({ region }),
}: BedrockTranscriberOptions = {}): (input: TranscribeInput) => Promise<ParsedTranscription> {
  return async function transcribe({ bytes, mimeType }: TranscribeInput): Promise<ParsedTranscription> {
    assertImageSize(bytes, MAX_IMAGE_BYTES);
    const text = await converseBedrock({
      client,
      modelId,
      maxTokens: MAX_TRANSCRIPTION_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { text: TRANSCRIBE_USER_PROMPT },
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
    return parseTranscription(text);
  };
}
