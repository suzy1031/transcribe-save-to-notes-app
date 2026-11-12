import { JSON_CONTENT_TYPE } from "./const.ts";
import { withFetchTimeout } from "./fetch-with-timeout.ts";
import { formatHttpErrorDetail, sanitizeErrorMessage } from "./sanitize-error.ts";

export const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
export const LINE_TEXT_LIMIT = 5000;
export const EMPTY_WEEK_MESSAGE = "今週対象のノートはありませんでした";
export const EMPTY_REMINDER_MESSAGE = "リマインドはありませんでした。";
export const EMPTY_CSV_MESSAGE = "今週対象のCSVはありませんでした";

export interface KindleSummaryLink {
  folderName: string;
  appLink?: string;
}

export interface CsvImportFailure {
  fileName: string;
  reason: string;
}

export interface LineClient {
  push(text: string): Promise<void>;
}

export function transcriptionSavedMessage(title: unknown, appLink?: string): string {
  const lines = [String(title).trim()];
  if (appLink) lines.push(appLink);
  return fitLineText(lines.join("\n"));
}

export function reminderDeliveredMessage(title: unknown, appLink?: string): string {
  const lines = ["【リマインダー】", String(title).trim()];
  if (appLink) lines.push(appLink);
  return fitLineText(lines.join("\n"));
}

export function transcriptionFailedMessage(fileName: string, reason: unknown): string {
  return fitLineText(
    `文字起こしに失敗しました\n${fileName}\n${sanitizeErrorMessage(reason)}`,
  );
}

export function kindleFailedMessage(reason: unknown): string {
  return fitLineText(`Kindle要約に失敗しました\n${sanitizeErrorMessage(reason)}`);
}

export function kindleRunSummaryMessage({
  summarized,
  failed,
  links,
}: {
  summarized: number;
  failed: number;
  links: ReadonlyArray<KindleSummaryLink>;
}): string {
  const lines = [`Kindle要約完了`, `処理: ${summarized}枚 / 失敗: ${failed}枚`];
  for (const { folderName, appLink } of links) {
    lines.push(String(folderName).trim());
    if (appLink) lines.push(appLink);
  }
  return fitLineText(lines.join("\n"));
}

export function reminderFailedMessage(reason: unknown): string {
  return fitLineText(`週次リマインドに失敗しました\n${sanitizeErrorMessage(reason)}`);
}

export function csvImportFailedMessage(reason: unknown): string {
  return fitLineText(`CSV取り込みに失敗しました\n${sanitizeErrorMessage(reason)}`);
}

export function csvImportSummaryMessage({
  imported,
  failed,
  spreadsheetUrl,
  failures = [],
}: {
  imported: number;
  failed: number;
  spreadsheetUrl?: string;
  failures?: ReadonlyArray<CsvImportFailure>;
}): string {
  const lines = ["CSV取り込み完了", `成功: ${imported}件 / 失敗: ${failed}件`];
  if (spreadsheetUrl) lines.push(spreadsheetUrl);
  for (const failure of failures) {
    lines.push(`${failure.fileName}: ${sanitizeErrorMessage(failure.reason)}`);
  }
  return fitLineText(lines.join("\n"));
}

export function fitLineText(text: unknown, limit: number = LINE_TEXT_LIMIT): string {
  const value = String(text);
  if (value.length <= limit) return value;
  return value.slice(0, limit);
}

export function linePushPayload(
  userId: string,
  text: string,
): { to: string; messages: Array<{ type: "text"; text: string }> } {
  return {
    to: userId,
    messages: [{ type: "text", text }],
  };
}

export function createLineClient({
  channelAccessToken,
  userId,
  fetchImpl = fetch,
}: {
  channelAccessToken?: string;
  userId?: string;
  fetchImpl?: typeof fetch;
}): LineClient {
  if (!channelAccessToken) throw new Error("LINE channel access token is required");
  if (!userId) throw new Error("LINE user ID is required");
  return {
    async push(text: string): Promise<void> {
      const response = await fetchImpl(
        LINE_PUSH_URL,
        withFetchTimeout({
          method: "POST",
          headers: {
            authorization: `Bearer ${channelAccessToken}`,
            "content-type": JSON_CONTENT_TYPE,
          },
          body: JSON.stringify(linePushPayload(userId, text)),
        }),
      );
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`LINE push failed: ${formatHttpErrorDetail(response.status, body, response.statusText)}`);
      }
    },
  };
}
