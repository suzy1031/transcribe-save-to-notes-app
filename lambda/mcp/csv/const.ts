import type { McpToolDefinition } from "../types.ts";

export const CSV_MCP_PROTOCOL_VERSION = "2025-03-26";
export const CSV_MCP_SERVER_NAME = "household-csv-mcp";
export const CSV_MCP_SERVER_VERSION = "1.0.0";

export const CSV_MCP_TOOLS: ReadonlyArray<McpToolDefinition> = [
  {
    name: "household_format_csv_to_markdown",
    description:
      "家計簿 CSV 文字列と過去の同月ノート行を受け取り、週次合計・デビット合計・現金合計・月次累計付きの Markdown テーブルを返します。",
    inputSchema: {
      type: "object",
      properties: {
        csvText: { type: "string", description: "UTF-8 の CSV 文字列" },
        title: { type: "string", description: "対象ノートタイトル（例: 2026-11-25_amounts）" },
        previousNotes: {
          type: "array",
          description: "月次累計の計算に使う過去週次ノートの配列（任意）",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              markdown: { type: "string" },
            },
            required: ["title", "markdown"],
          },
        },
      },
      required: ["csvText", "title"],
    },
  },
];
