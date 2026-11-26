import { createInterface } from "node:readline";
import { createObsidianMcpServerFromEnv } from "./index.ts";
import { JSONRPC_PARSE_ERROR, jsonRpcError } from "./jsonrpc.ts";
import type { ObsidianMcpServer } from "./types.ts";

/**
 * 1 行の JSON-RPC メッセージ文字列を処理し、レスポンスがある場合は JSON 文字列を返す。
 * @param server `ObsidianMcpServer` インスタンス
 * @param line 改行区切りの 1 行文字列
 * @returns 出力する JSON 文字列、または出力不要な場合は `null`
 */
export async function processStdioLine(server: ObsidianMcpServer, line: string): Promise<string | null> {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    return JSON.stringify(jsonRpcError(null, JSONRPC_PARSE_ERROR, "Parse error"));
  }
  const response = await server.handlePayload(payload);
  if (response === null) return null;
  return JSON.stringify(response);
}

/**
 * 標準入出力（stdio）を介して MCP サーバーを起動する。
 * @param server `ObsidianMcpServer` インスタンス
 */
export function startStdioMcpServer(server: ObsidianMcpServer = createObsidianMcpServerFromEnv()): void {
  const rl = createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on("line", async (line) => {
    const output = await processStdioLine(server, line);
    if (output !== null) {
      process.stdout.write(`${output}\n`);
    }
  });
}

if (import.meta.main) {
  startStdioMcpServer();
}
