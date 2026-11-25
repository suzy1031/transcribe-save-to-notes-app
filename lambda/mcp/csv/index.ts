import { createMcpFetchHandler } from "../http.ts";
import type { CreateMcpFetchHandlerOptions } from "../types.ts";
import { createCsvMcpServer } from "./server.ts";

/**
 * Bearer トークン認証付きの家計簿 CSV MCP HTTP / Lambda Fetch ハンドラーを生成する。
 * @param options サーバー実装・トークン解決関数・環境変数
 * @returns `fetch(request)` を持つハンドラーオブジェクト
 */
export function createCsvMcpFetchHandler(options: CreateMcpFetchHandlerOptions = {}): {
  fetch(request: Request): Promise<Response>;
} {
  return createMcpFetchHandler({
    ...options,
    createServer: options.createServer ?? (() => createCsvMcpServer()),
  });
}

export default createCsvMcpFetchHandler();
