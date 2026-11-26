import type { BaseSettings } from "./shared.ts";

export interface WeeklySettings extends BaseSettings {
  sourceFolderName: string;
  summaryFolderName: string;
}
