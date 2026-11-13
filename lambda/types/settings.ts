import type { GoogleServiceAccount } from "./drive.ts";

export interface BaseSettings {
  secretId: string;
  bedrockModelId: string;
  bedrockRegion: string;
  craftFolderName: string;
  craftApiBaseUrl: string;
  craftApiKey: string;
  anthropicApiKey: string;
  claudeModelId: string;
  transcriptionProvider: string;
  googleServiceAccountJson: string;
  lineChannelAccessToken: string;
  lineUserId: string;
}

export interface Credentials {
  serviceAccount?: GoogleServiceAccount;
  craftApiBaseUrl: string;
  craftApiKey: string;
  anthropicApiKey?: string;
  lineChannelAccessToken: string;
  lineUserId: string;
}

export interface WeeklySettings extends BaseSettings {
  sourceFolderName: string;
  processedFolderName: string;
  summaryFolderName: string;
}

export interface ReminderSettings extends BaseSettings {
  summaryFolderName: string;
}

export interface KindleSettings extends BaseSettings {
  driveParentFolderName: string;
  bookFolderPrefix: string;
  processedFolderName: string;
  summaryDocTitle: string;
  kindleClaudeModelId: string;
}

export interface CsvImportSettings extends BaseSettings {
  inboxFolderName: string;
  processedFolderName: string;
  spreadsheetId: string;
}
