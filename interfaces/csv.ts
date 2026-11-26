import type { BaseSettings } from "./shared.ts";

export interface FileLike {
  name?: string;
  mimeType?: string;
}

export interface CsvImportSettings extends BaseSettings {
  inboxFolderName: string;
  processedFolderName: string;
  householdBudgetFolder: string;
}

export interface MonthSums {
  total: number;
  debit: number;
  cash: number;
}
