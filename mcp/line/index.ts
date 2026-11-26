import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { SecretsClientLike } from "../../interfaces/shared.ts";
import { createLineClient } from "../../shared/line/line.ts";
import { loadCredentials, settingsFromEnv } from "../../shared/settings.ts";
import { createMcpFetchHandler } from "../http.ts";
import type { CreateMcpFetchHandlerOptions, McpServer } from "../types.ts";
import { createLineMcpServer } from "./server.ts";

/**
 * 環境変数と Secrets Manager から LINE クライアントを遅延初期化する MCP サーバーを構築する。
 * @param env 環境変数オブジェクト（デフォルトは `process.env`）
 * @param secretsClient Secrets Manager クライアント（テスト用オーバーライド可）
 * @returns `McpServer` インスタンス
 */
export function createLineMcpServerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  secretsClient?: SecretsClientLike,
): McpServer {
  return createLineMcpServer({
    resolveLine: async () => {
      const settings = settingsFromEnv(env);
      const client = secretsClient ?? new SecretsManagerClient({ region: settings.bedrockRegion });
      const credentials = await loadCredentials(settings, client);
      return createLineClient({
        channelAccessToken: credentials.lineChannelAccessToken,
        userId: credentials.lineUserId,
      });
    },
  });
}

/**
 * Bearer トークン認証付きの LINE 通知 MCP HTTP / Lambda Fetch ハンドラーを生成する。
 * @param options サーバー実装・トークン解決関数・環境変数
 * @returns `fetch(request)` を持つハンドラーオブジェクト
 */
export function createLineMcpFetchHandler(options: CreateMcpFetchHandlerOptions = {}): {
  fetch(request: Request): Promise<Response>;
} {
  const env = options.env ?? process.env;
  return createMcpFetchHandler({
    ...options,
    createServer: options.createServer ?? (() => createLineMcpServerFromEnv(env, options.secretsClient)),
  });
}

export default createLineMcpFetchHandler();
