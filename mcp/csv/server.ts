import {
  appendCashTotalRow,
  appendDebitTotalRow,
  appendTotalRow,
  parseCsv,
  parseMarkdownTable,
  rowsToMarkdownTable,
} from "../../shared/csv/csv.ts";
import { rowsWithCumulative } from "../../shared/csv/helper.ts";
import { sanitizeErrorMessage } from "../../shared/sanitize-error.ts";
import {
  createJsonRpcError,
  createMcpServerTransport,
  formatToolResult,
  isRecord,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_METHOD_NOT_FOUND,
} from "../jsonrpc.ts";
import type { McpServer, McpToolCallResult } from "../types.ts";
import { CSV_MCP_PROTOCOL_VERSION, CSV_MCP_SERVER_NAME, CSV_MCP_SERVER_VERSION, CSV_MCP_TOOLS } from "./const.ts";
import { parseFormatCsvArgs } from "./helper.ts";

/**
 * 家計簿 CSV 集計ドメインの操作を MCP として公開するサーバーを生成する。
 * @returns `McpServer` インスタンス
 */
export function createCsvMcpServer(): McpServer {
  async function executeTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    if (name !== "household_format_csv_to_markdown") {
      throw createJsonRpcError(JSONRPC_INVALID_PARAMS, `Unknown tool: ${name}`);
    }
    const { csvText, title, previousNotes } = parseFormatCsvArgs(args);
    const parsed = parseCsv(csvText);
    const weekly = appendCashTotalRow(appendDebitTotalRow(appendTotalRow(parsed)));
    const noteMap = new Map(previousNotes.map((note) => [note.title, note.markdown]));
    const rows = await rowsWithCumulative(
      weekly,
      title,
      previousNotes.map((note) => note.title),
      async (noteTitle) => {
        const md = noteMap.get(noteTitle);
        return md === undefined ? [] : parseMarkdownTable(md);
      },
    );
    const markdown = rowsToMarkdownTable(rows);
    return formatToolResult({ title, markdown, rowCount: rows.length });
  }

  async function dispatchMethod(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    switch (method) {
      case "initialize": {
        const requestedVersion =
          typeof params.protocolVersion === "string" && params.protocolVersion.trim() !== ""
            ? params.protocolVersion
            : CSV_MCP_PROTOCOL_VERSION;
        return {
          protocolVersion: requestedVersion,
          capabilities: { tools: {} },
          serverInfo: { name: CSV_MCP_SERVER_NAME, version: CSV_MCP_SERVER_VERSION },
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return { tools: CSV_MCP_TOOLS };
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
