import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { connectionSpaceId, craftAppDocumentLink, createCraftClient } from "./craft.js";
import { loadCredentials, settingsFromEnv } from "./index.js";
import {
  createLineClient,
  EMPTY_REMINDER_MESSAGE,
  reminderFailedMessage,
  transcriptionSavedMessage,
} from "./line.js";
import { daysBeforeTokyoDate } from "./weekly.js";

export function reminderTargetDate(now = new Date()) {
  return daysBeforeTokyoDate(now, 7);
}

export function reminderSettingsFromEnv(env = process.env) {
  return {
    ...settingsFromEnv(env),
    summaryFolderName: env.CRAFT_SUMMARY_FOLDER_NAME || "daily_note_summaries",
  };
}

export async function loadReminderCredentials(settings, secretsClient) {
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

export async function processReminder({ documents, pushLine, spaceId, targetDate }) {
  if (documents.length === 0) {
    await pushLine(EMPTY_REMINDER_MESSAGE);
    return { reminded: 0 };
  }
  if (documents.length > 1) {
    throw new Error(
      `Craft folder had ${documents.length} documents for ${targetDate}; expected exactly one`,
    );
  }

  const document = documents[0];
  const link = spaceId ? craftAppDocumentLink(spaceId, document.id) : "";
  await pushLine(transcriptionSavedMessage(document.title, link));
  return { reminded: 1, documentId: document.id };
}

export async function notifyReminderLineError({ line, credentials, error }) {
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
    console.error(`LINE通知失敗: ${pushError.message}`);
  }
}

export async function handler() {
  console.log("start");
  try {
    return await runReminder();
  } finally {
    console.log("end");
  }
}

async function runReminder() {
  let line = null;
  let credentials = null;
  try {
    const settings = reminderSettingsFromEnv();
    credentials = await loadReminderCredentials(
      settings,
      new SecretsManagerClient({ region: settings.bedrockRegion }),
    );
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
      console.error(`Craft connection lookup failed: ${error.message}`);
    }

    const now = new Date();
    const targetDate = reminderTargetDate(now);
    const documents = await craft.listDocuments({
      folderId: summaryFolderId,
      createdDateGte: targetDate,
      createdDateLte: targetDate,
    });
    const result = await processReminder({
      documents,
      pushLine: (text) => line.push(text),
      spaceId,
      targetDate,
    });
    console.log(`週次リマインド ${result.reminded}件 (${targetDate})`);
    return result;
  } catch (error) {
    await notifyReminderLineError({ line, credentials, error });
    throw error;
  }
}
