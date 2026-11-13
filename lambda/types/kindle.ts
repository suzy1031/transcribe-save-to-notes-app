import type { RecordWeeklyUsageOptions } from "./claude-usage.ts";
import type { BedrockClientLike } from "./transcribe.ts";

export type SummaryDocumentState =
  | { action: "create" }
  | { action: "append"; documentId: string }
  | { action: "error"; reason: string };

export interface ProcessKindleResult {
  foldersScanned: number;
  imagesSummarized: number;
  imagesFailed: number;
  foldersSkippedNoCraft?: number;
  deferred?: number;
  errors?: string[];
  links?: Array<{ folderName: string; documentId: string }>;
  folderLookup?: string;
}

export interface ClaudeKindleSummarizerOptions {
  apiKey?: string;
  modelId?: string;
  fetchImpl?: typeof fetch;
  recordUsage?: (options: RecordWeeklyUsageOptions) => Promise<unknown>;
}

export interface BedrockKindleSummarizerOptions {
  region?: string;
  modelId?: string;
  client?: BedrockClientLike;
}
