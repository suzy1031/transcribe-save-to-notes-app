import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import {
  DEFAULT_BEDROCK_MODEL_ID,
  MAX_IMAGE_BYTES,
  MAX_TRANSCRIPTION_TOKENS,
  TRANSCRIBE_USER_PROMPT,
} from "../shared/const.ts";
import { assertImageSize, parseTranscription } from "./parse.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import type { BedrockTranscriberOptions, ParsedTranscription, TranscribeInput } from "./types.ts";

export { MAX_IMAGE_BYTES as maxImageBytes };

function imageFormat(mimeType?: string): "png" | "jpeg" {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpeg";
  throw new Error(`Unsupported image type: ${mimeType}`);
}

export function createTranscriber({
  region,
  modelId = DEFAULT_BEDROCK_MODEL_ID,
  client = new BedrockRuntimeClient({ region }),
}: BedrockTranscriberOptions = {}): (input: TranscribeInput) => Promise<ParsedTranscription> {
  return async function transcribe({ bytes, mimeType }: TranscribeInput): Promise<ParsedTranscription> {
    assertImageSize(bytes, MAX_IMAGE_BYTES);
    const response = await client.send(
      new ConverseCommand({
        modelId,
        system: [{ text: SYSTEM_PROMPT }],
        messages: [
          {
            role: "user",
            content: [
              { text: TRANSCRIBE_USER_PROMPT },
              {
                image: {
                  format: imageFormat(mimeType),
                  source: { bytes: Buffer.from(bytes) },
                },
              },
            ],
          },
        ],
        inferenceConfig: { maxTokens: MAX_TRANSCRIPTION_TOKENS, temperature: 0 },
      }),
    );
    const text = (response.output?.message?.content ?? []).map((block: any) => block.text ?? "").join("");
    return parseTranscription(text);
  };
}
