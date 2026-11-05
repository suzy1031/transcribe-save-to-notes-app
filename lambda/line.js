import { JSON_CONTENT_TYPE } from "./const.js";

export const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
export const LINE_TEXT_LIMIT = 5000;
export const EMPTY_WEEK_MESSAGE = "今週対象のノートはありませんでした";
export const EMPTY_REMINDER_MESSAGE = "リマインドはありませんでした。";

export function transcriptionSavedMessage(title, appLink) {
  const lines = [String(title).trim()];
  if (appLink) lines.push(appLink);
  return fitLineText(lines.join("\n"));
}

export function transcriptionFailedMessage(fileName, reason) {
  return fitLineText(`文字起こしに失敗しました\n${fileName}\n${reason}`);
}

export function kindleFailedMessage(reason) {
  return fitLineText(`Kindle要約に失敗しました\n${String(reason).trim()}`);
}

export function kindleRunSummaryMessage({ summarized, failed, links }) {
  const lines = [`Kindle要約完了`, `処理: ${summarized}枚 / 失敗: ${failed}枚`];
  for (const { folderName, appLink } of links) {
    lines.push(String(folderName).trim());
    if (appLink) lines.push(appLink);
  }
  return fitLineText(lines.join("\n"));
}

export function reminderFailedMessage(reason) {
  return fitLineText(`週次リマインドに失敗しました\n${String(reason).trim()}`);
}

export function fitLineText(text, limit = LINE_TEXT_LIMIT) {
  const value = String(text);
  if (value.length <= limit) return value;
  return value.slice(0, limit);
}

export function linePushPayload(userId, text) {
  return {
    to: userId,
    messages: [{ type: "text", text }],
  };
}

export function createLineClient({ channelAccessToken, userId, fetchImpl = fetch }) {
  if (!channelAccessToken) throw new Error("LINE channel access token is required");
  if (!userId) throw new Error("LINE user ID is required");
  return {
    async push(text) {
      const response = await fetchImpl(LINE_PUSH_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${channelAccessToken}`,
          "content-type": JSON_CONTENT_TYPE,
        },
        body: JSON.stringify(linePushPayload(userId, text)),
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`LINE push failed: ${response.status} ${body.slice(0, 300)}`);
      }
    },
  };
}
