export const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
export const LINE_TEXT_LIMIT = 5000;
export const EMPTY_WEEK_MESSAGE = "今週対象のノートはありませんでした";

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
          "content-type": "application/json",
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
