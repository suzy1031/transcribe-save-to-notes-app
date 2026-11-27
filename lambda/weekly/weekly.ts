import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { Credentials, SecretsClientLike } from "../../interfaces/shared.ts";
import type { WeeklySettings } from "../../interfaces/weekly.ts";
import { bunLambdaHandler } from "../../shared/bun-handler.ts";
import {
  DEFAULT_MCP_DOMAIN_NAME,
  DEFAULT_OBSIDIAN_DAILY_FOLDER,
  DEFAULT_OBSIDIAN_SUMMARY_FOLDER,
  MAX_SUMMARY_TOKENS,
  TOKYO_TIME_ZONE,
  WEEKLY_LOOKBACK_DAYS,
} from "../../shared/const.ts";
import { runLogged } from "../../shared/job.ts";
import { EMPTY_WEEK_MESSAGE } from "../../shared/line/helper.ts";
import { buildMcpServerDefinitions, callClaudeMessages, requireNonEmptyText } from "../../shared/llm.ts";
import { loadCredentials, requireMcpAuthToken, settingsFromEnv } from "../../shared/settings.ts";
import { SUMMARY_SYSTEM_PROMPT } from "../../shared/summarize/summary-prompt.ts";
import { daysBeforeTokyoDate, tokyoDate } from "../../shared/tokyo-date.ts";

export function createdSinceDate(now: Date = new Date(), timeZone: string = TOKYO_TIME_ZONE): string {
  return daysBeforeTokyoDate(now, WEEKLY_LOOKBACK_DAYS, timeZone);
}

export function weeklySettingsFromEnv(env: NodeJS.ProcessEnv = process.env): WeeklySettings {
  return {
    ...settingsFromEnv(env),
    sourceFolderName: env.OBSIDIAN_DAILY_FOLDER || DEFAULT_OBSIDIAN_DAILY_FOLDER,
    summaryFolderName: env.OBSIDIAN_SUMMARY_FOLDER || DEFAULT_OBSIDIAN_SUMMARY_FOLDER,
  };
}

export async function loadWeeklyCredentials(
  settings: WeeklySettings,
  secretsClient: SecretsClientLike,
): Promise<Credentials> {
  if (settings.secretId) return loadCredentials(settings, secretsClient);
  return {
    anthropicApiKey: settings.anthropicApiKey,
    lineChannelAccessToken: settings.lineChannelAccessToken,
    lineUserId: settings.lineUserId,
    mcpAuthToken: process.env.MCP_AUTH_TOKEN ?? "",
  };
}

export async function runWeeklyWithMcp({
  settings = weeklySettingsFromEnv(),
  credentials,
  rootDomain = process.env.MCP_DOMAIN_NAME || DEFAULT_MCP_DOMAIN_NAME,
  now = new Date(),
  fetchImpl = fetch,
  recordUsage,
}: {
  settings?: WeeklySettings;
  credentials?: Credentials;
  rootDomain?: string;
  now?: Date;
  fetchImpl?: typeof fetch;
  recordUsage?: Parameters<typeof callClaudeMessages>[0]["recordUsage"];
} = {}): Promise<{ responseText: string }> {
  const creds =
    credentials ??
    (await loadWeeklyCredentials(settings, new SecretsManagerClient({ region: settings.bedrockRegion })));
  const mcpAuthToken = requireMcpAuthToken(creds);
  const since = createdSinceDate(now);
  const today = tokyoDate(now);
  const mcpServers = buildMcpServerDefinitions({
    domains: ["obsidian", "line", "usage"],
    authToken: mcpAuthToken,
    rootDomain,
  });

  const userPrompt = [
    `今日は ${today} です。Obsidian の "${settings.sourceFolderName}" フォルダから ${since} 以降のノートを検索・取得し、週次サマリーを作成してください。`,
    `ノートが 0 件の場合は "${EMPTY_WEEK_MESSAGE}" を LINE 通知して終了してください。`,
    `ノートがある場合は、要約を作成して "${settings.summaryFolderName}" フォルダへタイトル "週次まとめ ${today}"（date: "${today}", tags: ["weekly-summary"]）で保存し、LINE に要約を送信してください。`,
    `最後に今週の Claude 利用量レポートを取得し、データがあれば LINE にも送信してください。`,
  ].join("\n");

  const responseText = await callClaudeMessages({
    apiKey: creds.anthropicApiKey,
    wif: settings.anthropicWif,
    modelId: settings.claudeModelId,
    maxTokens: MAX_SUMMARY_TOKENS,
    system: SUMMARY_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
    mcpServers,
    functionName: "weekly",
    errorPrefix: "Claude MCP weekly summary failed",
    fetchImpl,
    ...(recordUsage ? { recordUsage } : {}),
  });
  return { responseText: requireNonEmptyText(responseText, "Claude MCP weekly summary returned empty response") };
}

export async function handler(): Promise<{ responseText: string }> {
  return runLogged(() => runWeeklyWithMcp());
}

export default bunLambdaHandler(handler);
