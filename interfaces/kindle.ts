import type { RecordWeeklyUsageOptions } from "./claude.ts";
import type { BaseSettings } from "./shared.ts";
import type { BedrockClientLike } from "./transcribe.ts";

export interface KindleSettings extends BaseSettings {
  driveParentFolderName: string;
  bookFolderPrefix: string;
  processedFolderName: string;
  obsidianKindleFolder: string;
  kindleClaudeModelId: string;
}

export interface ProcessKindleResult {
  foldersScanned: number;
  imagesSummarized: number;
  imagesFailed: number;
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
