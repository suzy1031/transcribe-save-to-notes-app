import { readFile } from "node:fs/promises";
import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import type { GoogleServiceAccount } from "../interfaces/drive.ts";
import type { AnthropicWifConfig, BaseSettings, Credentials, SecretsClientLike } from "../interfaces/shared.ts";
import {
  DEFAULT_AWS_REGION,
  DEFAULT_BEDROCK_MODEL_ID,
  DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID,
  DEFAULT_OBSIDIAN_DAILY_FOLDER,
  DEFAULT_OBSIDIAN_VAULT_NAME,
  DEFAULT_TRANSCRIPTION_PROVIDER,
} from "./const.ts";

function wifConfigFromEnv(env: NodeJS.ProcessEnv): AnthropicWifConfig | undefined {
  const federationRuleId = (env.ANTHROPIC_FEDERATION_RULE_ID ?? "").trim();
  const organizationId = (env.ANTHROPIC_ORGANIZATION_ID ?? "").trim();
  const serviceAccountId = (env.ANTHROPIC_SERVICE_ACCOUNT_ID ?? "").trim();
  const workspaceId = (env.ANTHROPIC_WORKSPACE_ID ?? "").trim();
  const values = [federationRuleId, organizationId, serviceAccountId, workspaceId];
  if (values.every((value) => value === "")) return undefined;
  if (values.some((value) => value === "")) {
    throw new Error(
      "ANTHROPIC_FEDERATION_RULE_ID, ANTHROPIC_ORGANIZATION_ID, ANTHROPIC_SERVICE_ACCOUNT_ID, and ANTHROPIC_WORKSPACE_ID must all be set together",
    );
  }
  return { federationRuleId, organizationId, serviceAccountId, workspaceId };
}

export function settingsFromEnv(env: NodeJS.ProcessEnv = process.env): BaseSettings {
  const anthropicWif = wifConfigFromEnv(env);
  return {
    secretId: env.SECRET_ID ?? "",
    bedrockModelId: env.BEDROCK_MODEL_ID || DEFAULT_BEDROCK_MODEL_ID,
    bedrockRegion: env.BEDROCK_REGION || env.AWS_REGION || DEFAULT_AWS_REGION,
    notesBucketName: env.NOTES_BUCKET_NAME ?? "",
    obsidianVaultName: env.OBSIDIAN_VAULT_NAME || DEFAULT_OBSIDIAN_VAULT_NAME,
    obsidianDailyFolder: env.OBSIDIAN_DAILY_FOLDER || DEFAULT_OBSIDIAN_DAILY_FOLDER,
    anthropicApiKey: env.ANTHROPIC_API_KEY ?? "",
    ...(anthropicWif ? { anthropicWif } : {}),
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
      anthropicApiKey?: string;
      lineChannelAccessToken?: string;
      lineUserId?: string;
      mcpAuthToken?: string;
    };
    return {
      serviceAccount: parsed.googleServiceAccount,
      anthropicApiKey: parsed.anthropicApiKey,
      lineChannelAccessToken: parsed.lineChannelAccessToken ?? "",
      lineUserId: parsed.lineUserId ?? "",
      mcpAuthToken: parsed.mcpAuthToken ?? "",
    };
  }
  if (!settings.googleServiceAccountJson) {
    throw new Error("SECRET_ID or local Google credentials are required");
  }
  const raw = settings.googleServiceAccountJson.trim().startsWith("{")
    ? settings.googleServiceAccountJson
    : await readFile(settings.googleServiceAccountJson, "utf8");
  return {
    serviceAccount: JSON.parse(raw) as GoogleServiceAccount,
    anthropicApiKey: settings.anthropicApiKey,
    lineChannelAccessToken: settings.lineChannelAccessToken ?? "",
    lineUserId: settings.lineUserId ?? "",
    mcpAuthToken: process.env.MCP_AUTH_TOKEN ?? "",
  };
}

export function requireMcpAuthToken(credentials: Pick<Credentials, "mcpAuthToken">): string {
  const token = (credentials.mcpAuthToken ?? "").trim();
  if (!token) throw new Error("mcpAuthToken is required");
  return token;
}
