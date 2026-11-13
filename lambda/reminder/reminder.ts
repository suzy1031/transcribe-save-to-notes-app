import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { connectionSpaceId, craftAppDocumentLink, createCraftClient } from "../craft/craft.ts";
import type { CraftClient, CraftListedDocument } from "../craft/types/craft.ts";
import { loadCredentials, settingsFromEnv } from "../inbox/index.ts";
import {
  createLineClient,
  EMPTY_REMINDER_MESSAGE,
  reminderDeliveredMessage,
  reminderFailedMessage,
} from "../line/line.ts";
import type { LineClient } from "../line/types/line.ts";
import { ALL_CRAFT_DOCUMENTS_SINCE, DEFAULT_CRAFT_SUMMARY_FOLDER, REMINDER_LOOKBACK_DAYS } from "../shared/const.ts";
import { sanitizeErrorMessage } from "../shared/sanitize-error.ts";
import type { SecretsClientLike } from "../shared/types/runtime.ts";
import type { Credentials } from "../shared/types/settings.ts";
import { daysBeforeTokyoDate } from "../weekly/weekly.ts";
import type { ReminderSettings } from "./types/reminder.ts";

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

export function filterDocumentsByReminderTitle<T extends { title?: string }>(
  documents: ReadonlyArray<T>,
  targetDate: string,
): T[] {
  const candidates = new Set<string>(reminderTitleCandidates(targetDate));
  return documents.filter((doc) => candidates.has(String(doc.title ?? "").trim()));
}

export async function listReminderDocuments(
  craft: Pick<CraftClient, "listDocuments">,
  summaryFolderId: string,
  targetDate: string,
): Promise<{
  documents: CraftListedDocument[];
  matchedBy: "createdDate" | "title" | "none";
}> {
  const byCreatedDate = await craft.listDocuments({
    folderId: summaryFolderId,
    createdDateGte: targetDate,
    createdDateLte: targetDate,
  });
  if (byCreatedDate.length > 0) {
    return { documents: byCreatedDate, matchedBy: "createdDate" };
  }

  const inFolder = await craft.listDocuments({
    folderId: summaryFolderId,
    createdDateGte: ALL_CRAFT_DOCUMENTS_SINCE,
  });
  const byTitle = filterDocumentsByReminderTitle(inFolder, targetDate);
  return { documents: byTitle, matchedBy: byTitle.length > 0 ? "title" : "none" };
}

export function reminderSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): ReminderSettings {
  return {
    ...settingsFromEnv(env),
    summaryFolderName: env.CRAFT_SUMMARY_FOLDER_NAME || DEFAULT_CRAFT_SUMMARY_FOLDER,
  };
}

export async function loadReminderCredentials(
  settings: ReminderSettings,
  secretsClient: SecretsClientLike,
): Promise<Credentials> {
  if (settings.secretId) return loadCredentials(settings, secretsClient);
  if (!settings.craftApiBaseUrl || !settings.craftApiKey) {
    throw new Error("SECRET_ID or local Craft credentials are required");
  }
  return {
    craftApiBaseUrl: settings.craftApiBaseUrl,
    craftApiKey: settings.craftApiKey,
    lineChannelAccessToken: settings.lineChannelAccessToken,
    lineUserId: settings.lineUserId,
  };
}

export async function processReminder({
  documents,
  pushLine,
  spaceId,
  targetDate,
}: {
  documents: ReadonlyArray<CraftListedDocument>;
  pushLine: (text: string) => Promise<void>;
  spaceId?: string;
  targetDate: string;
}): Promise<{ reminded: number; documentId?: string }> {
  if (documents.length === 0) {
    await pushLine(EMPTY_REMINDER_MESSAGE);
    return { reminded: 0 };
  }
  if (documents.length > 1) {
    throw new Error(`Craft folder had ${documents.length} documents for ${targetDate}; expected exactly one`);
  }

  const document = documents[0];
  const link = spaceId ? craftAppDocumentLink(spaceId, document.id) : "";
  await pushLine(reminderDeliveredMessage(document.title, link));
  return { reminded: 1, documentId: document.id };
}

export async function notifyReminderLineError({
  line,
  credentials,
  error,
}: {
  line?: LineClient | null;
  credentials?: Partial<Credentials> | null;
  error: { message?: unknown };
}): Promise<void> {
  const message = reminderFailedMessage(error.message);
  const client =
    line ??
    (credentials?.lineChannelAccessToken && credentials?.lineUserId
      ? createLineClient({
          channelAccessToken: credentials.lineChannelAccessToken,
          userId: credentials.lineUserId,
        })
      : null);
  if (!client) {
    console.error("LINE通知失敗: credentials are missing");
    return;
  }
  try {
    await client.push(message);
    console.log("LINE通知");
  } catch (pushError) {
    console.error(`LINE通知失敗: ${(pushError as Error).message}`);
  }
}

export async function handler(): Promise<{ reminded: number; documentId?: string }> {
  console.log("start");
  try {
    return await runReminder();
  } finally {
    console.log("end");
  }
}

async function runReminder(): Promise<{ reminded: number; documentId?: string }> {
  let line: LineClient | null = null;
  let credentials: Credentials | null = null;
  try {
    const settings = reminderSettingsFromEnv();
    credentials = await loadReminderCredentials(settings, new SecretsManagerClient({ region: settings.bedrockRegion }));
    line = createLineClient({
      channelAccessToken: credentials.lineChannelAccessToken,
      userId: credentials.lineUserId,
    });
    const craft = createCraftClient({
      baseUrl: credentials.craftApiBaseUrl,
      apiKey: credentials.craftApiKey,
    });
    const summaryFolderId = await craft.findFolder(settings.summaryFolderName);
    if (!summaryFolderId) {
      throw new Error(`Craft folder "${settings.summaryFolderName}" was not found`);
    }
    let spaceId = "";
    try {
      spaceId = connectionSpaceId(await craft.getConnection());
    } catch (error) {
      console.error(`Craft connection lookup failed: ${sanitizeErrorMessage((error as Error).message)}`);
    }

    const now = new Date();
    const targetDate = reminderTargetDate(now);
    const { documents, matchedBy } = await listReminderDocuments(craft, summaryFolderId, targetDate);
    if (matchedBy === "title") {
      console.log(`週次リマインド: 作成日0件のためタイトルで ${documents.length} 件 (${targetDate})`);
    }
    const result = await processReminder({
      documents,
      pushLine: (text) => line!.push(text),
      spaceId,
      targetDate,
    });
    console.log(`週次リマインド ${result.reminded}件 (${targetDate})`);
    return result;
  } catch (error) {
    await notifyReminderLineError({ line, credentials, error: error as Error });
    throw error;
  }
}
