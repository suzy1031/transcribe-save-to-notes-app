import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { settingsFromEnv } from "../shared/settings.ts";
import type { SecretsClientLike } from "../shared/types.ts";
import { isRecord, JSONRPC_UNAUTHORIZED, jsonRpcError, verifyBearerToken } from "./jsonrpc.ts";
import type { CreateMcpFetchHandlerOptions, McpServer } from "./types.ts";

/**
 * 環境変数 `MCP_AUTH_TOKEN` または Secrets Manager (`SECRET_ID`) の `mcpAuthToken` から認証トークンを取得する。
 * @param options 環境変数および Secrets Manager クライアント
 * @returns 取得した認証トークン文字列（未設定時は空文字）
 */
export async function loadMcpAuthToken({
  env = process.env,
  secretsClient,
}: {
  env?: NodeJS.ProcessEnv;
  secretsClient?: SecretsClientLike;
} = {}): Promise<string> {
  const fromEnv = (env.MCP_AUTH_TOKEN ?? "").trim();
  if (fromEnv) return fromEnv;
  const settings = settingsFromEnv(env);
  if (!settings.secretId) return "";
  const client = secretsClient ?? new SecretsManagerClient({ region: settings.bedrockRegion });
  const output = await client.send(new GetSecretValueCommand({ SecretId: settings.secretId }));
  const parsed = JSON.parse(output.SecretString ?? "{}") as { mcpAuthToken?: unknown };
  return typeof parsed.mcpAuthToken === "string" ? parsed.mcpAuthToken.trim() : "";
}

/**
 * Lambda Function URL / API Gateway イベントから Authorization ヘッダ値を抽出する。
 * @param event Lambda イベント
 * @returns Authorization ヘッダ文字列、または `null`
 */
export function extractEventAuthHeader(event: unknown): string | null {
  if (!isRecord(event) || !isRecord(event.headers)) return null;
  for (const [key, value] of Object.entries(event.headers)) {
    if (key.toLowerCase() === "authorization" && typeof value === "string") {
      return value;
    }
  }
  return null;
}

/**
 * Lambda Function URL / API Gateway イベントまたは生の JSON-RPC ペイロードをアンラップする。
 * @param event Lambda イベントまたは JSON-RPC リクエスト
 * @returns JSON-RPC ペイロード
 */
export function unwrapLambdaMcpEvent(event: unknown): unknown {
  if (isRecord(event) && typeof event.body === "string" && event.method === undefined) {
    const rawBody = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
    return JSON.parse(rawBody);
  }
  return event;
}

/**
 * Bearer トークン認証付きの MCP HTTP / Lambda Fetch ハンドラーを生成する。
 * @param options サーバー実装・トークン解決関数・環境変数
 * @returns `fetch(request)` を持つハンドラーオブジェクト
 */
export function createMcpFetchHandler({
  server,
  createServer,
  resolveAuthToken,
  env = process.env,
  secretsClient,
}: CreateMcpFetchHandlerOptions = {}): { fetch(request: Request): Promise<Response> } {
  let cachedServer: McpServer | undefined = server;
  let cachedTokenPromise: Promise<string> | undefined;

  function getServer(): McpServer {
    if (!cachedServer) {
      if (!createServer) {
        throw new Error("createMcpFetchHandler requires either server or createServer");
      }
      cachedServer = createServer();
    }
    return cachedServer;
  }

  function getExpectedToken(): Promise<string> {
    if (resolveAuthToken) return resolveAuthToken();
    if (!cachedTokenPromise) {
      cachedTokenPromise = loadMcpAuthToken({ env, secretsClient });
    }
    return cachedTokenPromise;
  }

  return {
    async fetch(request: Request): Promise<Response> {
      const expectedToken = await getExpectedToken();
      const cloned = request.clone();
      let parsedBody: unknown;
      let hasParsedBody = false;
      try {
        parsedBody = await cloned.json();
        hasParsedBody = true;
      } catch {
        // JSON パースエラー時は後段の handleHttpRequest に委譲する
      }

      const authHeader = request.headers.get("authorization") ?? extractEventAuthHeader(parsedBody);
      if (!verifyBearerToken(authHeader, expectedToken)) {
        return Response.json(
          jsonRpcError(null, JSONRPC_UNAUTHORIZED, "Unauthorized: invalid or missing Bearer token"),
          { status: 401 },
        );
      }

      const mcpServer = getServer();
      if (hasParsedBody) {
        try {
          const unwrapped = unwrapLambdaMcpEvent(parsedBody);
          if (unwrapped !== parsedBody) {
            const response = await mcpServer.handlePayload(unwrapped);
            if (response === null) return new Response(null, { status: 202 });
            return Response.json(response, { status: 200 });
          }
        } catch {
          // ラッパー内 JSON のパース失敗時は handleHttpRequest で Parse error を返す
        }
      }
      return mcpServer.handleHttpRequest(request);
    },
  };
}
