import * as bedrock from "./bedrock.ts";
import * as claude from "./claude.ts";
import { DEFAULT_TRANSCRIPTION_PROVIDER } from "../const.ts";
import type { ParsedTranscription } from "./parse.ts";

const providers: Record<string, typeof bedrock | typeof claude> = { bedrock, claude };

export function createTranscription({
  provider = DEFAULT_TRANSCRIPTION_PROVIDER,
  claude: claudeOptions,
  bedrock: bedrockOptions,
}: {
  provider?: string;
  claude?: claude.ClaudeTranscriberOptions;
  bedrock?: bedrock.BedrockTranscriberOptions;
}): {
  provider: string;
  maxImageBytes: number;
  transcribe: (input: claude.TranscribeInput) => Promise<ParsedTranscription>;
} {
  const selected = providers[provider];
  if (!selected) {
    throw new Error(`Unknown transcription provider: ${provider}`);
  }
  const options = provider === "bedrock" ? bedrockOptions : claudeOptions;
  return {
    provider,
    maxImageBytes: selected.maxImageBytes,
    transcribe: (selected.createTranscriber as (opts: any) => (input: claude.TranscribeInput) => Promise<ParsedTranscription>)(options),
  };
}

export { parseTranscription } from "./parse.ts";
export { maxImageBytes as MAX_IMAGE_BYTES } from "./claude.ts";
