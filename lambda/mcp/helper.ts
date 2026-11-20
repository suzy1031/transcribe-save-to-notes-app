import type { ListNotesParams, SaveNoteInput } from "../obsidian/types.ts";
import { JSONRPC_INVALID_PARAMS, JSONRPC_VERSION, OBSIDIAN_NOTE_URI_PREFIX } from "./const.ts";
import type {
  JsonRpcErrorResponse,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcSuccessResponse,
  McpToolCallResult,
} from "./types.ts";

/**
 * JSON-RPC のエラーコードを持つ例外を生成する。
 * @param code JSON-RPC エラーコード
 * @param message エラーメッセージ
 * @returns コード付き Error インスタンス
 */
export function createJsonRpcError(code: number, message: string): Error & { code: number } {
  const error = new Error(message) as Error & { code: number };
  error.code = code;
  return error;
}

/**
 * JSON-RPC 成功レスポンスを構築する。
 * @param id リクエスト ID
 * @param result 結果オブジェクト
 * @returns JSON-RPC 成功レスポンス
 */
export function jsonRpcSuccess(id: JsonRpcId, result: unknown): JsonRpcSuccessResponse {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    result,
  };
}

/**
 * JSON-RPC エラーレスポンスを構築する。
 * @param id リクエスト ID
 * @param code エラーコード
 * @param message エラーメッセージ
 * @returns JSON-RPC エラーレスポンス
 */
export function jsonRpcError(id: JsonRpcId, code: number, message: string): JsonRpcErrorResponse {
  return {
    jsonrpc: JSONRPC_VERSION,
    id,
    error: { code, message },
  };
}

/**
 * MCP ツール実行結果オブジェクトを構築する。
 * @param payload テキストまたは JSON シリアライズ対象の値
 * @param isError エラー結果かどうか
 * @returns `McpToolCallResult`
 */
export function formatToolResult(payload: unknown, isError = false): McpToolCallResult {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return {
    content: [{ type: "text", text }],
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * 任意の値がプレーンオブジェクト（Record）かどうかを判定する。
 * @param value 判定対象の値
 * @returns Record の場合は true
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 入力オブジェクトを検証し、`JsonRpcRequest` として取り出す。
 * @param value 任意の入力値
 * @returns 正規化された `JsonRpcRequest`、不正な場合は null
 */
export function parseJsonRpcRequest(value: unknown): JsonRpcRequest | null {
  if (!isRecord(value)) return null;
  if (value.jsonrpc !== undefined && value.jsonrpc !== JSONRPC_VERSION) return null;
  if (typeof value.method !== "string" || value.method.trim() === "") return null;
  const id = value.id;
  if (id !== undefined && id !== null && typeof id !== "string" && typeof id !== "number") {
    return null;
  }
  const params = value.params;
  if (params !== undefined && !isRecord(params)) {
    throw createJsonRpcError(JSONRPC_INVALID_PARAMS, "Invalid params: expected an object");
  }
  return {
    jsonrpc: JSONRPC_VERSION,
    ...(id !== undefined ? { id } : {}),
    method: value.method,
    ...(params !== undefined ? { params } : {}),
  };
}

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
