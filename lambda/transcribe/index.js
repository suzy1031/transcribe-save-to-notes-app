import * as bedrock from "./bedrock.js";
import * as claude from "./claude.js";

const providers = { bedrock, claude };

export function createTranscription({ provider = "claude", claude: claudeOptions, bedrock: bedrockOptions }) {
  const selected = providers[provider];
  if (!selected) {
    throw new Error(`Unknown transcription provider: ${provider}`);
  }
  const options = provider === "bedrock" ? bedrockOptions : claudeOptions;
  return {
    provider,
    maxImageBytes: selected.maxImageBytes,
    transcribe: selected.createTranscriber(options),
  };
}

export { parseTranscription } from "./parse.js";
export { maxImageBytes as MAX_IMAGE_BYTES } from "./claude.js";
