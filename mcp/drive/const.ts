import type { McpToolDefinition } from "../types.ts";

export const DRIVE_MCP_PROTOCOL_VERSION = "2025-03-26";
export const DRIVE_MCP_SERVER_NAME = "google-drive-mcp";
export const DRIVE_MCP_SERVER_VERSION = "1.0.0";

export const DRIVE_MCP_TOOLS: ReadonlyArray<McpToolDefinition> = [
  {
    name: "drive_list_inbox_files",
    description:
      "指定フォルダ（images: 00_notes_inbox / csv: csv_inbox / kindle: kindle_* フォルダ一覧）内の未処理ファイル・フォルダ一覧を取得します。",
    inputSchema: {
      type: "object",
      properties: {
        folderType: {
          type: "string",
          enum: ["images", "csv", "kindle"],
          description: "取得対象の種類（省略時は images）",
        },
        folderName: {
          type: "string",
          description: "対象フォルダ名の上書き（省略時は種別ごとのデフォルトフォルダ名を使用）",
        },
        folderId: {
          type: "string",
          description: "フォルダ ID を直接指定する場合に指定（指定時はフォルダ名検索をスキップ）",
        },
      },
    },
  },
  {
    name: "drive_download_file",
    description:
      "指定した Google Drive の fileId からファイル内容（base64 または utf8 テキスト）をダウンロードします。",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "Google Drive のファイル ID" },
        encoding: {
          type: "string",
          enum: ["base64", "utf8"],
          description: "返却エンコーディング（画像は base64、CSV 等は utf8。省略時は base64）",
        },
      },
      required: ["fileId"],
    },
  },
  {
    name: "drive_mark_as_processed",
    description:
      "処理済みファイルを移動先フォルダへ移動します。noteKey（または craftDocumentId）を指定すると appProperties にも記録します。",
    inputSchema: {
      type: "object",
      properties: {
        fileId: { type: "string", description: "移動対象のファイル ID" },
        inboxFolderId: { type: "string", description: "現在の親フォルダ ID" },
        processedFolderId: { type: "string", description: "移動先の処理済みフォルダ ID" },
        processedFolderName: {
          type: "string",
          description: "processedFolderId を省略した場合に名前から検索する処理済みフォルダ名（例: 01_processed）",
        },
        noteKey: {
          type: "string",
          description: "保存先 Obsidian ノートキー等の参照識別子（appProperties.craftDocumentId に記録）",
        },
      },
      required: ["fileId", "inboxFolderId"],
    },
  },
  {
    name: "drive_cleanup_companion_texts",
    description:
      "指定フォルダ内の対応する画像が残っていない不要な .txt ファイルを削除します（403 エラー時は processedFolderId へ移動）。",
    inputSchema: {
      type: "object",
      properties: {
        inboxFolderId: { type: "string", description: "クリーンアップ対象のフォルダ ID" },
        processedFolderId: {
          type: "string",
          description: "削除権限がない（403）場合の退避先フォルダ ID（省略可）",
        },
      },
      required: ["inboxFolderId"],
    },
  },
];
