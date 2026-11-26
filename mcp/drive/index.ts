import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { SecretsClientLike } from "../../interfaces/shared.ts";
import { createDriveClient } from "../../shared/drive/drive.ts";
import { loadCredentials, settingsFromEnv } from "../../shared/settings.ts";
import { createMcpFetchHandler } from "../http.ts";
import type { CreateMcpFetchHandlerOptions, McpServer } from "../types.ts";
import { createDriveMcpServer } from "./server.ts";

/**
 * 環境変数と Secrets Manager から Google Drive クライアントを遅延初期化する MCP サーバーを構築する。
 * @param env 環境変数オブジェクト（デフォルトは `process.env`）
 * @param secretsClient Secrets Manager クライアント（テスト用オーバーライド可）
 * @returns `McpServer` インスタンス
 */
export function createDriveMcpServerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  secretsClient?: SecretsClientLike,
): McpServer {
  return createDriveMcpServer({
    resolveDrive: async () => {
      const settings = settingsFromEnv(env);
      const client = secretsClient ?? new SecretsManagerClient({ region: settings.bedrockRegion });
      const credentials = await loadCredentials(settings, client);
      return createDriveClient({ serviceAccount: credentials.serviceAccount });
    },
  });
}

/**
 * Bearer トークン認証付きの Google Drive MCP HTTP / Lambda Fetch ハンドラーを生成する。
 * @param options サーバー実装・トークン解決関数・環境変数
 * @returns `fetch(request)` を持つハンドラーオブジェクト
 */
export function createDriveMcpFetchHandler(options: CreateMcpFetchHandlerOptions = {}): {
  fetch(request: Request): Promise<Response>;
} {
  const env = options.env ?? process.env;
  return createMcpFetchHandler({
    ...options,
    createServer: options.createServer ?? (() => createDriveMcpServerFromEnv(env, options.secretsClient)),
  });
}

export default createDriveMcpFetchHandler();
