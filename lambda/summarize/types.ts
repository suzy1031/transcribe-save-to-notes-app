import type { RecordWeeklyUsageOptions } from "../claude/types.ts";
import type { BedrockClientLike } from "../transcribe/types.ts";

export interface NoteInput {
  title: string;
  markdown: string;
}

export interface ClaudeSummarizerOptions {
  apiKey?: string;
  modelId?: string;
  fetchImpl?: typeof fetch;
  recordUsage?: (options: RecordWeeklyUsageOptions) => Promise<unknown>;
}

export interface BedrockSummarizerOptions {
  region?: string;
  modelId?: string;
  client?: BedrockClientLike;
}
