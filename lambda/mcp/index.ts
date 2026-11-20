import { createObsidianClient } from "../obsidian/obsidian.ts";
import { settingsFromEnv } from "../shared/settings.ts";
import { isRecord } from "./helper.ts";
import { createObsidianMcpServer } from "./server.ts";
import type { ObsidianMcpServer } from "./types.ts";

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

export default {
  async fetch(request: Request): Promise<Response> {
    const server = createObsidianMcpServerFromEnv();
    const cloned = request.clone();
    try {
      const parsed = await cloned.json();
      const unwrapped = unwrapLambdaMcpEvent(parsed);
      if (unwrapped !== parsed) {
        const response = await server.handlePayload(unwrapped);
        if (response === null) return new Response(null, { status: 202 });
        return Response.json(response, { status: 200 });
      }
    } catch {
      // JSON パースエラー時は handleHttpRequest 側で標準の JSON-RPC Parse error を返す
    }
    return server.handleHttpRequest(request);
  },
};
