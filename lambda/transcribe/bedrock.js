import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { SYSTEM_PROMPT } from "../prompt.js";
import { assertImageSize, parseTranscription } from "./parse.js";

const DEFAULT_MODEL_ID = "amazon.nova-lite-v1:0";

export const maxImageBytes = 7 * 1024 * 1024;

function imageFormat(mimeType) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpeg";
  throw new Error(`Unsupported image type: ${mimeType}`);
}

export function createTranscriber({
  region,
  modelId = DEFAULT_MODEL_ID,
  client = new BedrockRuntimeClient({ region }),
} = {}) {
  return async function transcribe({ bytes, mimeType }) {
    assertImageSize(bytes, maxImageBytes);
    const response = await client.send(
      new ConverseCommand({
        modelId,
        system: [{ text: SYSTEM_PROMPT }],
        messages: [
          {
            role: "user",
            content: [
              { text: "この手書きノート画像を読み取ってください。" },
              {
                image: {
                  format: imageFormat(mimeType),
                  source: { bytes: Buffer.from(bytes) },
                },
              },
            ],
          },
        ],
        inferenceConfig: { maxTokens: 4096, temperature: 0 },
      }),
    );
    const text = (response.output?.message?.content ?? [])
      .map((block) => block.text ?? "")
      .join("");
    return parseTranscription(text);
  };
}
