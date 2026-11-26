import type { LineClient } from "../../interfaces/line.ts";
import { sanitizeErrorMessage } from "../../shared/sanitize-error.ts";
import {
  createJsonRpcError,
  createMcpServerTransport,
  formatToolResult,
  isRecord,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_METHOD_NOT_FOUND,
} from "../jsonrpc.ts";
import type { CreateLineMcpServerOptions, McpServer, McpToolCallResult } from "../types.ts";
import { LINE_MCP_PROTOCOL_VERSION, LINE_MCP_SERVER_NAME, LINE_MCP_SERVER_VERSION, LINE_MCP_TOOLS } from "./const.ts";
import { parseSendNotificationArgs } from "./helper.ts";

/**
 * LINE 通知ドメインの操作を MCP として公開するサーバーを生成する。
 * @param options `line` クライアントまたは遅延解決関数 `resolveLine`
 * @returns `McpServer` インスタンス
 */
export function createLineMcpServer({ line, resolveLine }: CreateLineMcpServerOptions): McpServer {
  let cachedLine: LineClient | undefined = line;

  async function getLine(): Promise<LineClient> {
    if (!cachedLine) {
      if (!resolveLine) {
        throw new Error("createLineMcpServer requires either line or resolveLine");
      }
      cachedLine = await resolveLine();
    }
    return cachedLine;
  }

  async function executeTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    if (name !== "line_send_notification") {
      throw createJsonRpcError(JSONRPC_INVALID_PARAMS, `Unknown tool: ${name}`);
    }
    const { text } = parseSendNotificationArgs(args);
    const client = await getLine();
    await client.push(text);
    return formatToolResult({ sent: true, length: text.length });
  }

  async function dispatchMethod(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    switch (method) {
      case "initialize": {
        const requestedVersion =
          typeof params.protocolVersion === "string" && params.protocolVersion.trim() !== ""
            ? params.protocolVersion
            : LINE_MCP_PROTOCOL_VERSION;
        return {
          protocolVersion: requestedVersion,
          capabilities: { tools: {} },
          serverInfo: { name: LINE_MCP_SERVER_NAME, version: LINE_MCP_SERVER_VERSION },
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return { tools: LINE_MCP_TOOLS };
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
      default:
        throw createJsonRpcError(JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  return createMcpServerTransport(dispatchMethod);
}
