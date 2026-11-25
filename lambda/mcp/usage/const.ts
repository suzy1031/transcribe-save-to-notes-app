import type { McpToolDefinition } from "../types.ts";

export const USAGE_MCP_PROTOCOL_VERSION = "2025-03-26";
export const USAGE_MCP_SERVER_NAME = "claude-usage-mcp";
export const USAGE_MCP_SERVER_VERSION = "1.0.0";
export const USAGE_RESOURCE_URI = "usage://claude/weekly";

export const USAGE_MCP_RESOURCES = [
  {
    uri: USAGE_RESOURCE_URI,
    name: "Claude Weekly Usage",
    description: "今週の Claude API 利用回数・トークン数・推定料金（USD / JPY）レポート",
    mimeType: "text/plain",
  },
] as const;

export const USAGE_MCP_TOOLS: ReadonlyArray<McpToolDefinition> = [
  {
    name: "usage_get_weekly_report",
    description:
      "DynamoDB から今週（または指定週）の Claude API 利用量と最新 USD/JPY レートを取得し、レポートを返します。",
    inputSchema: {
      type: "object",
      properties: {
        pk: { type: "string", description: "ISO 週キー（例: WEEK#2026-W48、省略時は今週）" },
        includeFxRate: {
          type: "boolean",
          description: "USD/JPY 為替レートを取得して円換算を含めるか（省略時は true）",
        },
      },
    },
  },
  {
    name: "usage_record_weekly",
    description: "Claude API のトークン使用量を DynamoDB の週次集計レコードに加算記録します。",
    inputSchema: {
      type: "object",
      properties: {
        functionName: {
          type: "string",
          enum: ["index", "weekly", "kindle"],
          description: "呼び出し元の機能区分（index / weekly / kindle）",
        },
        modelId: { type: "string", description: "使用した Claude モデル ID" },
        inputTokens: { type: "number", description: "入力トークン数" },
        outputTokens: { type: "number", description: "出力トークン数" },
        cacheCreationInputTokens: { type: "number", description: "キャッシュ作成入力トークン数（任意）" },
        cacheReadInputTokens: { type: "number", description: "キャッシュ読取入力トークン数（任意）" },
      },
      required: ["functionName", "modelId"],
    },
  },
];
