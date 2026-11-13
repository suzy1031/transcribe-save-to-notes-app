import { JSON_CONTENT_TYPE } from "../shared/const.ts";
import { withFetchTimeout } from "../shared/fetch-with-timeout.ts";
import { formatHttpErrorDetail } from "../shared/sanitize-error.ts";
import { linePushPayload } from "./helper.ts";
import type { LineClient } from "./types/line.ts";

export const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";

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
