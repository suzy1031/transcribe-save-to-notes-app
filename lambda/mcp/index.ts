import { createObsidianClient } from "../obsidian/obsidian.ts";
import { settingsFromEnv } from "../shared/settings.ts";
import { createMcpFetchHandler, extractEventAuthHeader, loadMcpAuthToken, unwrapLambdaMcpEvent } from "./http.ts";
import { createObsidianMcpServer } from "./obsidian/server.ts";
import type { CreateMcpFetchHandlerOptions, ObsidianMcpServer } from "./types.ts";

export { extractEventAuthHeader, loadMcpAuthToken, unwrapLambdaMcpEvent };

/**
 * 環境変数から Obsidian (S3 Vault) クライアントを初期化し、MCP サーバーを構築する。
 * @param env 環境変数オブジェクト（デフォルトは `process.env`）
 * @returns `ObsidianMcpServer` インスタンス
 */
export function createObsidianMcpServerFromEnv(env: NodeJS.ProcessEnv = process.env): ObsidianMcpServer {
  const settings = settingsFromEnv(env);
  const obsidian = createObsidianClient({
    bucketName: settings.notesBucketName,
    region: settings.bedrockRegion,
  });
  return createObsidianMcpServer({
    obsidian,
    vaultName: settings.obsidianVaultName,
  });
}

/**
 * Bearer トークン認証付きの Obsidian MCP HTTP / Lambda Fetch ハンドラーを生成する。
 * @param options サーバー実装・トークン解決関数・環境変数
 * @returns `fetch(request)` を持つハンドラーオブジェクト
 */
export function createMcpFetchHandlerForObsidian(options: CreateMcpFetchHandlerOptions = {}): {
  fetch(request: Request): Promise<Response>;
} {
  const env = options.env ?? process.env;
  return createMcpFetchHandler({
    ...options,
    createServer: options.createServer ?? (() => createObsidianMcpServerFromEnv(env)),
  });
}

export { createMcpFetchHandlerForObsidian as createMcpFetchHandler };

export default createMcpFetchHandlerForObsidian();
