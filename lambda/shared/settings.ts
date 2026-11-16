import { readFile } from "node:fs/promises";
import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import type { GoogleServiceAccount } from "../drive/types.ts";
import {
  DEFAULT_AWS_REGION,
  DEFAULT_BEDROCK_MODEL_ID,
  DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID,
  DEFAULT_CRAFT_TRANSCRIBE_FOLDER,
  DEFAULT_TRANSCRIPTION_PROVIDER,
} from "./const.ts";
import type { BaseSettings, Credentials, SecretsClientLike } from "./types.ts";

export function settingsFromEnv(env: NodeJS.ProcessEnv = process.env): BaseSettings {
  return {
    secretId: env.SECRET_ID ?? "",
    bedrockModelId: env.BEDROCK_MODEL_ID || DEFAULT_BEDROCK_MODEL_ID,
    bedrockRegion: env.BEDROCK_REGION || env.AWS_REGION || DEFAULT_AWS_REGION,
    craftFolderName: env.CRAFT_FOLDER_NAME || DEFAULT_CRAFT_TRANSCRIBE_FOLDER,
    craftApiBaseUrl: env.CRAFT_API_BASE_URL ?? "",
    craftApiKey: env.CRAFT_API_KEY ?? "",
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? "",
    claudeModelId: env.CLAUDE_MODEL_ID || DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID,
    transcriptionProvider: env.TRANSCRIPTION_PROVIDER || DEFAULT_TRANSCRIPTION_PROVIDER,
    googleServiceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "",
    lineChannelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
    lineUserId: env.LINE_USER_ID ?? "",
  };
}

export async function loadCredentials(settings: BaseSettings, secretsClient: SecretsClientLike): Promise<Credentials> {
  if (settings.secretId) {
    const output = await secretsClient.send(new GetSecretValueCommand({ SecretId: settings.secretId }));
    const parsed = JSON.parse(output.SecretString ?? "") as {
      googleServiceAccount?: GoogleServiceAccount;
      craftApiBaseUrl: string;
      craftApiKey: string;
      anthropicApiKey?: string;
      lineChannelAccessToken?: string;
      lineUserId?: string;
    };
    return {
      serviceAccount: parsed.googleServiceAccount,
      craftApiBaseUrl: parsed.craftApiBaseUrl,
      craftApiKey: parsed.craftApiKey,
      anthropicApiKey: parsed.anthropicApiKey,
      lineChannelAccessToken: parsed.lineChannelAccessToken ?? "",
      lineUserId: parsed.lineUserId ?? "",
    };
  }
  if (!settings.googleServiceAccountJson || !settings.craftApiBaseUrl || !settings.craftApiKey) {
    throw new Error("SECRET_ID or local Google and Craft credentials are required");
  }
  const raw = settings.googleServiceAccountJson.trim().startsWith("{")
    ? settings.googleServiceAccountJson
    : await readFile(settings.googleServiceAccountJson, "utf8");
  return {
    serviceAccount: JSON.parse(raw) as GoogleServiceAccount,
    craftApiBaseUrl: settings.craftApiBaseUrl,
    craftApiKey: settings.craftApiKey,
    anthropicApiKey: settings.anthropicApiKey,
    lineChannelAccessToken: settings.lineChannelAccessToken ?? "",
    lineUserId: settings.lineUserId ?? "",
  };
}
