import type { McpToolDefinition } from "../types.ts";

export const LINE_MCP_PROTOCOL_VERSION = "2025-03-26";
export const LINE_MCP_SERVER_NAME = "line-notification-mcp";
export const LINE_MCP_SERVER_VERSION = "1.0.0";

export const LINE_MCP_TOOLS: ReadonlyArray<McpToolDefinition> = [
  {
    name: "line_send_notification",
    description: "LINE Messaging API の Push メッセージを送信します（5000 文字を超える場合は自動で切り詰めます）。",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", description: "送信する通知テキスト" },
      },
      required: ["text"],
    },
  },
];
