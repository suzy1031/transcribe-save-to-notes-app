import { createJsonRpcError, JSONRPC_INVALID_PARAMS } from "../jsonrpc.ts";

function optionalString(args: Record<string, unknown>, field: string): string | undefined {
  const value = args[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw createJsonRpcError(JSONRPC_INVALID_PARAMS, `Invalid parameter type for ${field}: expected string`);
  }
  return value.trim() || undefined;
}

function optionalNonNegativeNumber(args: Record<string, unknown>, field: string): number {
  const value = args[field];
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw createJsonRpcError(JSONRPC_INVALID_PARAMS, `Invalid parameter for ${field}: expected non-negative number`);
  }
  return value;
}

/**
 * `usage_get_weekly_report` ツール引数を検証・正規化する。
 * @param args ツール引数オブジェクト
 * @returns 週キーと為替レート取得フラグ
 */
export function parseGetWeeklyReportArgs(args: Record<string, unknown>): {
  pk?: string;
  includeFxRate: boolean;
} {
  const pk = optionalString(args, "pk");
  const rawIncludeFxRate = args.includeFxRate;
  if (rawIncludeFxRate !== undefined && typeof rawIncludeFxRate !== "boolean") {
    throw createJsonRpcError(JSONRPC_INVALID_PARAMS, "Invalid parameter type for includeFxRate: expected boolean");
  }
  return {
    ...(pk ? { pk } : {}),
    includeFxRate: rawIncludeFxRate ?? true,
  };
}

/**
 * `usage_record_weekly` ツール引数を検証・正規化する。
 * @param args ツール引数オブジェクト
 * @returns 利用量記録パラメータ
 */
export function parseRecordWeeklyArgs(args: Record<string, unknown>): {
  functionName: string;
  modelId: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
} {
  const functionName = optionalString(args, "functionName");
  if (!functionName || !["index", "weekly", "kindle"].includes(functionName)) {
    throw createJsonRpcError(
      JSONRPC_INVALID_PARAMS,
      "Missing or invalid functionName (expected index, weekly, or kindle)",
    );
  }
  const modelId = optionalString(args, "modelId");
  if (!modelId) {
    throw createJsonRpcError(JSONRPC_INVALID_PARAMS, "Missing or invalid required parameter: modelId");
  }
  return {
    functionName,
    modelId,
    usage: {
      input_tokens: optionalNonNegativeNumber(args, "inputTokens"),
      output_tokens: optionalNonNegativeNumber(args, "outputTokens"),
      cache_creation_input_tokens: optionalNonNegativeNumber(args, "cacheCreationInputTokens"),
      cache_read_input_tokens: optionalNonNegativeNumber(args, "cacheReadInputTokens"),
    },
  };
}
