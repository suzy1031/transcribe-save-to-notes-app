import type { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import type { GoogleServiceAccount } from "./drive.ts";

export interface SecretsClientLike {
  send(command: GetSecretValueCommand): Promise<{ SecretString?: string }>;
}

export interface LambdaContextLike {
  getRemainingTimeInMillis(): number;
}

export interface BaseSettings {
  secretId: string;
  bedrockModelId: string;
  bedrockRegion: string;
  notesBucketName: string;
  obsidianVaultName: string;
  obsidianDailyFolder: string;
  anthropicApiKey: string;
  claudeModelId: string;
  transcriptionProvider: string;
  googleServiceAccountJson: string;
  lineChannelAccessToken: string;
  lineUserId: string;
}

export interface Credentials {
  serviceAccount?: GoogleServiceAccount;
  anthropicApiKey?: string;
  lineChannelAccessToken: string;
  lineUserId: string;
  mcpAuthToken?: string;
}
