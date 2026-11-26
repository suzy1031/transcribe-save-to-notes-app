import type { BaseSettings } from "./shared.ts";

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
