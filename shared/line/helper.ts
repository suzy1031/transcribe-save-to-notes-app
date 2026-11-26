export const LINE_TEXT_LIMIT = 5000;
export const EMPTY_WEEK_MESSAGE = "今週対象のノートはありませんでした";
export const EMPTY_REMINDER_MESSAGE = "リマインドはありませんでした。";
export const EMPTY_CSV_MESSAGE = "今週対象のCSVはありませんでした";

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
