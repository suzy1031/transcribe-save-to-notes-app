import type { BaseSettings } from "../shared/types.ts";

export interface WeeklySettings extends BaseSettings {
  sourceFolderName: string;
  summaryFolderName: string;
}
