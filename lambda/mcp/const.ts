import type { McpResourceTemplate, McpToolDefinition } from "./types.ts";

export const MCP_PROTOCOL_VERSION = "2025-03-26";
export const MCP_SERVER_NAME = "obsidian-s3-mcp";
export const MCP_SERVER_VERSION = "1.0.0";
export const JSONRPC_VERSION = "2.0";

export const JSONRPC_PARSE_ERROR = -32700;
export const JSONRPC_INVALID_REQUEST = -32600;
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INVALID_PARAMS = -32602;
export const JSONRPC_INTERNAL_ERROR = -32603;

export const OBSIDIAN_NOTE_URI_PREFIX = "obsidian://note/";

export const OBSIDIAN_RESOURCE_TEMPLATES: ReadonlyArray<McpResourceTemplate> = [
  {
    uriTemplate: "obsidian://note/{key}",
    name: "Obsidian Note",
    description: "S3 上の Obsidian Vault に保存されている Markdown ノート本文（frontmatter 除去済み）",
    mimeType: "text/markdown",
  },
];

export const OBSIDIAN_MCP_TOOLS: ReadonlyArray<McpToolDefinition> = [
  {
    name: "obsidian_create_note",
    description:
      "指定フォルダに YAML frontmatter 付きで新規 Markdown ノートを作成（既存ファイルがある場合は上書き）します。",
    inputSchema: {
      type: "object",
      properties: {
        folder: { type: "string", description: "Vault 内の保存先フォルダ名（例: 00_daily_notes）" },
        title: { type: "string", description: "ノートのタイトル（例: 2026/11/21）" },
        markdown: { type: "string", description: "ノートの Markdown 本文（frontmatter は除く）" },
        date: {
          type: "string",
          description: "frontmatter に設定する YYYY-MM-DD 形式の日付（省略時はタイトルから自動抽出）",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: 'frontmatter に設定するタグ配列（例: ["daily"]）',
        },
      },
      required: ["folder", "title", "markdown"],
    },
  },
  {
    name: "obsidian_save_or_append_note",
    description:
      "指定フォルダに Markdown ノートを保存します。同名ノートが既に存在する場合は末尾に追記し、存在しない場合は新規作成します。",
    inputSchema: {
      type: "object",
      properties: {
        folder: { type: "string", description: "Vault 内の保存先フォルダ名（例: 00_daily_notes）" },
        title: { type: "string", description: "ノートのタイトル（例: 2026/11/21）" },
        markdown: { type: "string", description: "保存または追記する Markdown 本文（frontmatter は除く）" },
        date: { type: "string", description: "新規作成時に frontmatter に設定する YYYY-MM-DD 形式の日付" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "新規作成時に frontmatter に設定するタグ配列",
        },
      },
      required: ["folder", "title", "markdown"],
    },
  },
  {
    name: "obsidian_list_notes",
    description: "指定フォルダ内の Obsidian ノート一覧を取得します。作成日（YYYY-MM-DD）の範囲で絞り込み可能です。",
    inputSchema: {
      type: "object",
      properties: {
        folder: { type: "string", description: "検索対象の Vault フォルダ名（例: 00_daily_notes）" },
        createdDateGte: { type: "string", description: "開始日（YYYY-MM-DD、この日以降）" },
        createdDateLte: { type: "string", description: "終了日（YYYY-MM-DD、この日以前）" },
      },
      required: ["folder"],
    },
  },
  {
    name: "obsidian_read_note",
    description: "指定したノートキー（Vault 相対パス）の Markdown 本文（frontmatter 除去済み）を読み取ります。",
    inputSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "S3 オブジェクトキー / Vault 相対パス（例: 00_daily_notes/2026-11-21.md）",
        },
      },
      required: ["key"],
    },
  },
  {
    name: "obsidian_get_app_link",
    description: "Obsidian アプリで該当ノートを直接開くためのディープリンク URL（obsidian://open?...）を生成します。",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Vault 内のノートパス（例: 00_daily_notes/2026-11-21.md）" },
        vaultName: {
          type: "string",
          description: "Obsidian Vault 名（省略時はサーバー設定のデフォルト Vault 名を使用）",
        },
      },
      required: ["key"],
    },
  },
];
