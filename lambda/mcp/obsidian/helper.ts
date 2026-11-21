import type { ListNotesParams, SaveNoteInput } from "../../obsidian/types.ts";
import { createJsonRpcError, JSONRPC_INVALID_PARAMS } from "../jsonrpc.ts";
import { OBSIDIAN_NOTE_URI_PREFIX } from "./const.ts";

function requireNonEmptyString(args: Record<string, unknown>, field: string): string {
  const value = args[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw createJsonRpcError(JSONRPC_INVALID_PARAMS, `Missing or invalid required parameter: ${field}`);
  }
  return value;
}

function optionalString(args: Record<string, unknown>, field: string): string | undefined {
  const value = args[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw createJsonRpcError(JSONRPC_INVALID_PARAMS, `Invalid parameter type for ${field}: expected string`);
  }
  return value.trim() || undefined;
}

function optionalStringArray(args: Record<string, unknown>, field: string): string[] | undefined {
  const value = args[field];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw createJsonRpcError(JSONRPC_INVALID_PARAMS, `Invalid parameter type for ${field}: expected string[]`);
  }
  return value;
}

/**
 * ツール引数を `SaveNoteInput`（`createNote` / `saveOrAppendNote` 用）として検証・変換する。
 * @param args ツール引数オブジェクト
 * @returns 検証済みの `SaveNoteInput`
 */
export function parseSaveNoteArgs(args: Record<string, unknown>): SaveNoteInput {
  const folder = requireNonEmptyString(args, "folder");
  const title = requireNonEmptyString(args, "title");
  const markdown = args.markdown;
  if (typeof markdown !== "string") {
    throw createJsonRpcError(JSONRPC_INVALID_PARAMS, "Missing or invalid required parameter: markdown");
  }
  const date = optionalString(args, "date");
  const tags = optionalStringArray(args, "tags");
  return {
    folder,
    title,
    markdown,
    ...(date ? { date } : {}),
    ...(tags ? { tags } : {}),
  };
}

/**
 * ツール引数を `ListNotesParams`（`listNotes` 用）として検証・変換する。
 * @param args ツール引数オブジェクト
 * @returns 検証済みの `ListNotesParams`
 */
export function parseListNotesArgs(args: Record<string, unknown>): ListNotesParams {
  const folder = requireNonEmptyString(args, "folder");
  const createdDateGte = optionalString(args, "createdDateGte");
  const createdDateLte = optionalString(args, "createdDateLte");
  return {
    folder,
    ...(createdDateGte ? { createdDateGte } : {}),
    ...(createdDateLte ? { createdDateLte } : {}),
  };
}

/**
 * `obsidian://note/{key}` 形式のリソース URI から S3 オブジェクトキーを抽出する。
 * @param uri リソース URI
 * @returns 抽出・デコードされたノートキー
 */
export function parseObsidianNoteUri(uri: unknown): string {
  if (typeof uri !== "string" || !uri.startsWith(OBSIDIAN_NOTE_URI_PREFIX)) {
    throw createJsonRpcError(JSONRPC_INVALID_PARAMS, `Unsupported resource URI: ${String(uri ?? "")}`);
  }
  const encodedKey = uri.slice(OBSIDIAN_NOTE_URI_PREFIX.length);
  const key = decodeURIComponent(encodedKey).trim().replace(/^\/+/, "");
  if (!key) {
    throw createJsonRpcError(JSONRPC_INVALID_PARAMS, "Resource URI is missing note key");
  }
  return key;
}
