import { timingSafeEqual } from "node:crypto";
import type {
  JsonRpcErrorResponse,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcSuccessResponse,
  McpToolCallResult,
} from "./types.ts";

export const JSONRPC_VERSION = "2.0";

export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;
export const JSONRPC_UNAUTHORIZED = -32001;

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

/**
 * `Authorization: Bearer <token>` ヘッダを期待されるトークンと定数時間比較で検証する。
 * 期待トークンが未設定（空文字）の場合は常に `false` を返す。
 * @param authorizationHeader リクエストの Authorization ヘッダ値
 * @param expectedToken サーバー側で設定された正しい Bearer トークン
 * @returns トークンが一致した場合は `true`
 */
export function verifyBearerToken(
  authorizationHeader: string | null | undefined,
  expectedToken: string | null | undefined,
): boolean {
  const expected = String(expectedToken ?? "").trim();
  if (!expected) return false;
  const header = String(authorizationHeader ?? "").trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const provided = match[1].trim();
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");
  if (expectedBuf.byteLength !== providedBuf.byteLength) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
