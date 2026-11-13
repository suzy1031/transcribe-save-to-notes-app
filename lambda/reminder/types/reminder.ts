import type { BaseSettings } from "../../shared/types/settings.ts";

export interface ReminderSettings extends BaseSettings {
  summaryFolderName: string;
}
