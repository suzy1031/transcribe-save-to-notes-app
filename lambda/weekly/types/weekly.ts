import type { BaseSettings } from "../../shared/types/settings.ts";

export interface WeeklySettings extends BaseSettings {
  sourceFolderName: string;
  processedFolderName: string;
  summaryFolderName: string;
}
