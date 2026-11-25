import { formatWeeklyUsage, getWeeklyUsage, recordWeeklyUsage } from "../../claude/claude-usage.ts";
import { fetchUsdJpyRate } from "../../claude/fx-rate.ts";
import { sanitizeErrorMessage } from "../../shared/sanitize-error.ts";
import {
  createJsonRpcError,
  createMcpServerTransport,
  formatToolResult,
  isRecord,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_METHOD_NOT_FOUND,
} from "../jsonrpc.ts";
import type { CreateUsageMcpServerOptions, McpServer, McpToolCallResult } from "../types.ts";
import {
  USAGE_MCP_PROTOCOL_VERSION,
  USAGE_MCP_RESOURCES,
  USAGE_MCP_SERVER_NAME,
  USAGE_MCP_SERVER_VERSION,
  USAGE_MCP_TOOLS,
  USAGE_RESOURCE_URI,
} from "./const.ts";
import { parseGetWeeklyReportArgs, parseRecordWeeklyArgs } from "./helper.ts";

/**
 * Claude 利用料集計ドメインの操作を MCP として公開するサーバーを生成する。
 * @param options DynamoDB 取得・記録・為替取得の実装（省略時は本番モジュールを使用）
 * @returns `McpServer` インスタンス
 */
export function createUsageMcpServer({
  getWeeklyUsage: getUsage = getWeeklyUsage,
  recordWeeklyUsage: recordUsage = recordWeeklyUsage,
  fetchUsdJpyRate: fetchRate = fetchUsdJpyRate,
  tableName = process.env.CLAUDE_USAGE_TABLE_NAME ?? "",
}: CreateUsageMcpServerOptions = {}): McpServer {
  async function buildWeeklyReport({ pk, includeFxRate }: { pk?: string; includeFxRate: boolean }) {
    const [item, usdJpyRate] = await Promise.all([
      getUsage({ tableName, ...(pk ? { pk } : {}) }),
      includeFxRate ? fetchRate() : Promise.resolve(null),
    ]);
    const report = formatWeeklyUsage(item, usdJpyRate);
    return { pk: item?.pk ?? pk ?? null, item, usdJpyRate, report };
  }

  async function executeTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    switch (name) {
      case "usage_get_weekly_report": {
        const params = parseGetWeeklyReportArgs(args);
        return formatToolResult(await buildWeeklyReport(params));
      }
      case "usage_record_weekly": {
        const params = parseRecordWeeklyArgs(args);
        const recorded = await recordUsage({
          tableName,
          functionName: params.functionName,
          modelId: params.modelId,
          usage: params.usage,
        });
        return formatToolResult({ recorded });
      }
      default:
        throw createJsonRpcError(JSONRPC_INVALID_PARAMS, `Unknown tool: ${name}`);
    }
  }

  async function dispatchMethod(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    switch (method) {
      case "initialize": {
        const requestedVersion =
          typeof params.protocolVersion === "string" && params.protocolVersion.trim() !== ""
            ? params.protocolVersion
            : USAGE_MCP_PROTOCOL_VERSION;
        return {
          protocolVersion: requestedVersion,
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: USAGE_MCP_SERVER_NAME, version: USAGE_MCP_SERVER_VERSION },
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return { tools: USAGE_MCP_TOOLS };
      case "tools/call": {
        const name = typeof params.name === "string" ? params.name.trim() : "";
        if (!name) throw createJsonRpcError(JSONRPC_INVALID_PARAMS, "Missing tool name");
        const rawArgs = params.arguments ?? {};
        if (!isRecord(rawArgs)) {
          throw createJsonRpcError(JSONRPC_INVALID_PARAMS, "Invalid tool arguments: expected an object");
        }
        try {
          return await executeTool(name, rawArgs);
        } catch (error) {
          const err = error as Error & { code?: number };
          if (typeof err.code === "number") throw err;
          return formatToolResult(`Tool execution failed: ${sanitizeErrorMessage(err.message)}`, true);
        }
      }
      case "resources/list":
        return { resources: USAGE_MCP_RESOURCES };
      case "resources/templates/list":
        return { resourceTemplates: [] };
      case "resources/read": {
        if (params.uri !== USAGE_RESOURCE_URI) {
          throw createJsonRpcError(JSONRPC_INVALID_PARAMS, `Unsupported resource URI: ${String(params.uri ?? "")}`);
        }
        const { report } = await buildWeeklyReport({ includeFxRate: true });
        return {
          contents: [{ uri: USAGE_RESOURCE_URI, mimeType: "text/plain", text: report }],
        };
      }
      default:
        throw createJsonRpcError(JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  return createMcpServerTransport(dispatchMethod);
}
