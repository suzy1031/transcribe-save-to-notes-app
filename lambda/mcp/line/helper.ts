import { fitLineText } from "../../line/helper.ts";
import { createJsonRpcError, JSONRPC_INVALID_PARAMS } from "../jsonrpc.ts";

/**
 * `line_send_notification` ツール引数を検証・正規化する。
 * @param args ツール引数オブジェクト
 * @returns LINE 文字数上限内に整形された送信テキスト
 */
export function parseSendNotificationArgs(args: Record<string, unknown>): { text: string } {
  const raw = args.text;
  if (typeof raw !== "string" || raw.trim() === "") {
    throw createJsonRpcError(JSONRPC_INVALID_PARAMS, "Missing or invalid required parameter: text");
  }
  return { text: fitLineText(raw) };
}
