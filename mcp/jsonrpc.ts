import { timingSafeEqual } from "node:crypto";
import { sanitizeErrorMessage } from "../shared/sanitize-error.ts";
import type {
  JsonRpcErrorResponse,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
  McpServer,
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

/**
 * JSON-RPC ディスパッチ関数をラップし、共通の `handleMessage` / `handlePayload` / `handleHttpRequest` を提供する。
 * @param dispatchMethod JSON-RPC メソッドを処理する関数
 * @returns `McpServer` インスタンス
 */
export function createMcpServerTransport(
  dispatchMethod: (method: string, params?: Record<string, unknown>) => Promise<unknown>,
): McpServer {
  async function handleMessage(message: unknown): Promise<JsonRpcResponse | null> {
    const rawId =
      isRecord(message) && (typeof message.id === "string" || typeof message.id === "number") ? message.id : null;
    let request: ReturnType<typeof parseJsonRpcRequest>;
    try {
      request = parseJsonRpcRequest(message);
    } catch (error) {
      const err = error as Error & { code?: number };
      return jsonRpcError(rawId, err.code ?? JSONRPC_INVALID_REQUEST, err.message);
    }
    if (!request) {
      return jsonRpcError(rawId, JSONRPC_INVALID_REQUEST, "Invalid Request");
    }

    // `id` が指定されていないメッセージは JSON-RPC Notification として扱う
    if (request.id === undefined) {
      return null;
    }

    try {
      const result = await dispatchMethod(request.method, request.params);
      return jsonRpcSuccess(request.id, result);
    } catch (error) {
      const err = error as Error & { code?: number };
      const code = typeof err.code === "number" ? err.code : JSONRPC_INTERNAL_ERROR;
      return jsonRpcError(request.id, code, sanitizeErrorMessage(err.message));
    }
  }

  async function handlePayload(payload: unknown): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
    if (Array.isArray(payload)) {
      if (payload.length === 0) {
        return jsonRpcError(null, JSONRPC_INVALID_REQUEST, "Invalid Request: empty batch");
      }
      const responses: JsonRpcResponse[] = [];
      for (const item of payload) {
        const res = await handleMessage(item);
        if (res !== null) responses.push(res);
      }
      return responses.length > 0 ? responses : null;
    }
    return handleMessage(payload);
  }

  async function handleHttpRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json(
        jsonRpcError(null, JSONRPC_INVALID_REQUEST, "Method Not Allowed: use POST for MCP requests"),
        { status: 405 },
      );
    }
    const text = await request.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return Response.json(jsonRpcError(null, JSONRPC_PARSE_ERROR, "Parse error"), { status: 400 });
    }
    const result = await handlePayload(payload);
    if (result === null) {
      return new Response(null, { status: 202 });
    }
    return Response.json(result, { status: 200 });
  }

  return {
    handleMessage,
    handlePayload,
    handleHttpRequest,
  };
}
