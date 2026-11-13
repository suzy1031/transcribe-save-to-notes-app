import type { GoogleServiceAccount } from "../../drive/types/drive.ts";

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
