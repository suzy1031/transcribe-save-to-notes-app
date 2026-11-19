import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { EMPTY_REMINDER_MESSAGE, reminderDeliveredMessage, reminderFailedMessage } from "../line/helper.ts";
import { createLineClient } from "../line/line.ts";
import type { LineClient } from "../line/types.ts";
import { obsidianAppNoteLink } from "../obsidian/helper.ts";
import { createObsidianClient } from "../obsidian/obsidian.ts";
import type { ObsidianClient, ObsidianListedNote } from "../obsidian/types.ts";
import { bunLambdaHandler } from "../shared/bun-handler.ts";
import { ALL_NOTES_SINCE, DEFAULT_OBSIDIAN_SUMMARY_FOLDER, REMINDER_LOOKBACK_DAYS } from "../shared/const.ts";
import { pushLineMessage, runLogged } from "../shared/job.ts";
import { loadCredentials, settingsFromEnv } from "../shared/settings.ts";
import { daysBeforeTokyoDate } from "../shared/tokyo-date.ts";
import type { Credentials, SecretsClientLike } from "../shared/types.ts";
import type { ReminderSettings } from "./types.ts";

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
  obsidian: Pick<ObsidianClient, "listNotes">,
  summaryFolder: string,
  targetDate: string,
): Promise<{
  documents: ObsidianListedNote[];
  matchedBy: "createdDate" | "title" | "none";
}> {
  const byCreatedDate = await obsidian.listNotes({
    folder: summaryFolder,
    createdDateGte: targetDate,
    createdDateLte: targetDate,
  });
  if (byCreatedDate.length > 0) {
    return { documents: byCreatedDate, matchedBy: "createdDate" };
  }

  const inFolder = await obsidian.listNotes({
    folder: summaryFolder,
    createdDateGte: ALL_NOTES_SINCE,
  });
  const byTitle = filterDocumentsByReminderTitle(inFolder, targetDate);
  return { documents: byTitle, matchedBy: byTitle.length > 0 ? "title" : "none" };
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
  };
}

export async function processReminder({
  documents,
  pushLine,
  vaultName,
  targetDate,
}: {
  documents: ReadonlyArray<Pick<ObsidianListedNote, "id" | "title">>;
  pushLine: (text: string) => Promise<void>;
  vaultName?: string;
  targetDate: string;
}): Promise<{ reminded: number; documentId?: string }> {
  if (documents.length === 0) {
    await pushLine(EMPTY_REMINDER_MESSAGE);
    return { reminded: 0 };
  }
  if (documents.length > 1) {
    throw new Error(`Summary folder had ${documents.length} documents for ${targetDate}; expected exactly one`);
  }

  const document = documents[0];
  const link = vaultName ? obsidianAppNoteLink(vaultName, document.id) : "";
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
  await pushLineMessage(client, message);
}

export async function handler(): Promise<{ reminded: number; documentId?: string }> {
  return runLogged(() => runReminder());
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
    const obsidian = createObsidianClient({
      bucketName: settings.notesBucketName,
      region: settings.bedrockRegion,
    });

    const now = new Date();
    const targetDate = reminderTargetDate(now);
    const { documents, matchedBy } = await listReminderDocuments(obsidian, settings.summaryFolderName, targetDate);
    if (matchedBy === "title") {
      console.log(`週次リマインド: 作成日0件のためタイトルで ${documents.length} 件 (${targetDate})`);
    }
    const result = await processReminder({
      documents,
      pushLine: (text) => line!.push(text),
      vaultName: settings.obsidianVaultName,
      targetDate,
    });
    console.log(`週次リマインド ${result.reminded}件 (${targetDate})`);
    return result;
  } catch (error) {
    await notifyReminderLineError({ line, credentials, error: error as Error });
    throw error;
  }
}

export default bunLambdaHandler(handler);
