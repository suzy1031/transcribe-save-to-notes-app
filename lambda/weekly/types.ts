import type { BaseSettings } from "../shared/types.ts";

export interface WeeklySettings extends BaseSettings {
  sourceFolderName: string;
  processedFolderName: string;
  summaryFolderName: string;
}
