import { createLineClient } from "../line/line.ts";
import type { LineClient } from "../line/types.ts";
import { sanitizeErrorMessage } from "./sanitize-error.ts";

export async function runLogged<Result>(run: () => Promise<Result>): Promise<Result> {
  console.log("start");
  try {
    return await run();
  } finally {
    console.log("end");
  }
}

export async function pushLineMessage(line: LineClient | null, text: string): Promise<void> {
  if (!line) {
    console.error("LINE通知失敗: credentials are missing");
    return;
  }
  try {
    await line.push(text);
    console.log("LINE通知");
  } catch (error) {
    console.error(`LINE通知失敗: ${sanitizeErrorMessage((error as Error).message)}`);
  }
}

export function createLinePush(
  credentials: {
    lineChannelAccessToken?: string;
    lineUserId?: string;
  },
  fetchImpl: typeof fetch = fetch,
): (text: string) => Promise<void> {
  const line =
    credentials.lineChannelAccessToken && credentials.lineUserId
      ? createLineClient({
          channelAccessToken: credentials.lineChannelAccessToken,
          userId: credentials.lineUserId,
          fetchImpl,
        })
      : null;
  return (text) => pushLineMessage(line, text);
}
