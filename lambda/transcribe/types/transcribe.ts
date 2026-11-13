import type { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import type { RecordWeeklyUsageOptions } from "../../claude/types/claude-usage.ts";

export interface ParsedTranscription {
  title: string;
  markdown: string;
}

export interface TranscribeInput {
  bytes: Uint8Array | Buffer;
  mimeType?: string;
}

export interface ClaudeTranscriberOptions {
  apiKey?: string;
  modelId?: string;
  fetchImpl?: typeof fetch;
  recordUsage?: (options: RecordWeeklyUsageOptions) => Promise<unknown>;
}

export interface BedrockClientLike {
  send(command: ConverseCommand): Promise<any>;
}

export interface BedrockTranscriberOptions {
  region?: string;
  modelId?: string;
  client?: BedrockClientLike;
}
