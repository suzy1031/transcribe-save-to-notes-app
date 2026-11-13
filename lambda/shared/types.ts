import type { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import type { GoogleServiceAccount } from "../drive/types.ts";

export interface SecretsClientLike {
  send(command: GetSecretValueCommand): Promise<{ SecretString?: string }>;
}

export interface LambdaContextLike {
  getRemainingTimeInMillis(): number;
}

export interface LoggerLike {
  info(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

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
