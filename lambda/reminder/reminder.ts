import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { ReminderSettings } from "../../interfaces/reminder.ts";
import type { Credentials, SecretsClientLike } from "../../interfaces/shared.ts";
import { bunLambdaHandler } from "../../shared/bun-handler.ts";
import {
  ALL_NOTES_SINCE,
  DEFAULT_CLAUDE_WEEKLY_MODEL_ID,
  DEFAULT_MCP_DOMAIN_NAME,
  DEFAULT_OBSIDIAN_SUMMARY_FOLDER,
  MAX_SUMMARY_TOKENS,
  REMINDER_LOOKBACK_DAYS,
} from "../../shared/const.ts";
import { runLogged } from "../../shared/job.ts";
import { EMPTY_REMINDER_MESSAGE } from "../../shared/line/helper.ts";
import { buildMcpServerDefinitions, callClaudeMessages } from "../../shared/llm.ts";
import { loadCredentials, requireMcpAuthToken, settingsFromEnv } from "../../shared/settings.ts";
import { daysBeforeTokyoDate } from "../../shared/tokyo-date.ts";

export const REMINDER_TITLE_PREFIX = "週次まとめ ";

export function reminderTargetDate(now: Date = new Date()): string {
  return daysBeforeTokyoDate(now, REMINDER_LOOKBACK_DAYS);
}

export function reminderTitleCandidates(targetDate: string): [string, string] {
  const [year, month, day] = targetDate.split("-").map(Number);
  if (!year || !month || !day) {
    throw new Error(`Invalid reminder targetDate: ${targetDate}`);
  }
  const padded = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return [`${REMINDER_TITLE_PREFIX}${padded}`, `${REMINDER_TITLE_PREFIX}${year}-${month}-${day}`];
}

export function reminderSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): ReminderSettings {
  return {
    ...settingsFromEnv(env),
    summaryFolderName: env.OBSIDIAN_SUMMARY_FOLDER || DEFAULT_OBSIDIAN_SUMMARY_FOLDER,
  };
}

export async function loadReminderCredentials(
  settings: ReminderSettings,
  secretsClient: SecretsClientLike,
): Promise<Credentials> {
  if (settings.secretId) return loadCredentials(settings, secretsClient);
  return {
    lineChannelAccessToken: settings.lineChannelAccessToken,
    lineUserId: settings.lineUserId,
    mcpAuthToken: process.env.MCP_AUTH_TOKEN ?? "",
  };
}

export async function runReminderWithMcp({
  settings = reminderSettingsFromEnv(),
  credentials,
  rootDomain = process.env.MCP_DOMAIN_NAME || DEFAULT_MCP_DOMAIN_NAME,
  now = new Date(),
  fetchImpl = fetch,
  recordUsage,
}: {
  settings?: ReminderSettings;
  credentials?: Credentials;
  rootDomain?: string;
  now?: Date;
  fetchImpl?: typeof fetch;
  recordUsage?: Parameters<typeof callClaudeMessages>[0]["recordUsage"];
} = {}): Promise<{ responseText: string }> {
  const creds =
    credentials ??
    (await loadReminderCredentials(settings, new SecretsManagerClient({ region: settings.bedrockRegion })));
  const mcpAuthToken = requireMcpAuthToken(creds);
  const targetDate = reminderTargetDate(now);
  const [paddedTitle, unpaddedTitle] = reminderTitleCandidates(targetDate);
  const mcpServers = buildMcpServerDefinitions({
    domains: ["obsidian", "line"],
    authToken: mcpAuthToken,
    rootDomain,
  });

  const userPrompt = [
    `Obsidian の "${settings.summaryFolderName}" フォルダから ${targetDate} の週次まとめを検索し、LINE でリマインド通知してください。`,
    `1. まず obsidian_list_notes（folder="${settings.summaryFolderName}", createdDateGte="${targetDate}", createdDateLte="${targetDate}"）で検索してください。`,
    `2. 0 件だった場合は obsidian_list_notes（folder="${settings.summaryFolderName}", createdDateGte="${ALL_NOTES_SINCE}"）で全件取得し、タイトルが "${paddedTitle}" または "${unpaddedTitle}" に一致するノートを探してください。`,
    `3. 見つかった場合は obsidian_get_app_link で appLink を取得し、line_send_notification で "【リマインダー】\\n<title>\\n<appLink>" を送信してください。`,
    `4. 見つからなかった場合は line_send_notification で "${EMPTY_REMINDER_MESSAGE}" を送信してください。`,
  ].join("\n");

  const responseText = await callClaudeMessages({
    apiKey: creds.anthropicApiKey,
    wif: settings.anthropicWif,
    modelId: process.env.CLAUDE_MODEL_ID || DEFAULT_CLAUDE_WEEKLY_MODEL_ID,
    maxTokens: MAX_SUMMARY_TOKENS,
    system: "あなたは週次リマインダーの実行担当です。指示された手順どおりに MCP ツールを呼び出して処理してください。",
    messages: [{ role: "user", content: userPrompt }],
    mcpServers,
    functionName: "weekly",
    errorPrefix: "Claude MCP reminder failed",
    fetchImpl,
    ...(recordUsage ? { recordUsage } : {}),
  });
  return { responseText };
}

export async function handler(): Promise<{ responseText: string }> {
  return runLogged(() => runReminderWithMcp());
}

export default bunLambdaHandler(handler);
