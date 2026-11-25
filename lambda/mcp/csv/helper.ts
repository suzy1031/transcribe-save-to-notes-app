import { createJsonRpcError, isRecord, JSONRPC_INVALID_PARAMS } from "../jsonrpc.ts";

export interface PreviousNoteInput {
  title: string;
  markdown: string;
}

function requireNonEmptyString(args: Record<string, unknown>, field: string): string {
  const value = args[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw createJsonRpcError(JSONRPC_INVALID_PARAMS, `Missing or invalid required parameter: ${field}`);
  }
  return value;
}

/**
 * `household_format_csv_to_markdown` ツール引数を検証・正規化する。
 * @param args ツール引数オブジェクト
 * @returns CSV 文字列、ノートタイトル、過去ノート配列
 */
export function parseFormatCsvArgs(args: Record<string, unknown>): {
  csvText: string;
  title: string;
  previousNotes: PreviousNoteInput[];
} {
  const csvText = requireNonEmptyString(args, "csvText");
  const title = requireNonEmptyString(args, "title").trim();
  const rawPrevious = args.previousNotes;
  if (rawPrevious === undefined || rawPrevious === null) {
    return { csvText, title, previousNotes: [] };
  }
  if (!Array.isArray(rawPrevious)) {
    throw createJsonRpcError(JSONRPC_INVALID_PARAMS, "Invalid parameter type for previousNotes: expected array");
  }
  const previousNotes: PreviousNoteInput[] = rawPrevious.map((item, index) => {
    if (!isRecord(item) || typeof item.title !== "string" || typeof item.markdown !== "string") {
      throw createJsonRpcError(
        JSONRPC_INVALID_PARAMS,
        `Invalid previousNotes[${index}]: expected { title: string, markdown: string }`,
      );
    }
    return { title: item.title, markdown: item.markdown };
  });
  return { csvText, title, previousNotes };
}
