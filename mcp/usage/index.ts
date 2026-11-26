import { createMcpFetchHandler } from "../http.ts";
import type { CreateMcpFetchHandlerOptions } from "../types.ts";
import { createUsageMcpServer } from "./server.ts";

/**
 * Bearer トークン認証付きの Claude 利用料集計 MCP HTTP / Lambda Fetch ハンドラーを生成する。
 * @param options サーバー実装・トークン解決関数・環境変数
 * @returns `fetch(request)` を持つハンドラーオブジェクト
 */
export function createUsageMcpFetchHandler(options: CreateMcpFetchHandlerOptions = {}): {
  fetch(request: Request): Promise<Response>;
} {
  const env = options.env ?? process.env;
  return createMcpFetchHandler({
    ...options,
    createServer:
      options.createServer ?? (() => createUsageMcpServer({ tableName: env.CLAUDE_USAGE_TABLE_NAME ?? "" })),
  });
}

export default createUsageMcpFetchHandler();
