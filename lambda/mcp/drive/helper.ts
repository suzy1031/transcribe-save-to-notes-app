import {
  DEFAULT_CSV_INBOX_FOLDER,
  DEFAULT_KINDLE_DRIVE_PARENT,
  INBOX_FOLDER_NAME,
  PROCESSED_DRIVE_FOLDER_NAME,
} from "../../shared/const.ts";
import { createJsonRpcError, JSONRPC_INVALID_PARAMS } from "../jsonrpc.ts";

export type DriveListFolderType = "images" | "csv" | "kindle";

function requireNonEmptyString(args: Record<string, unknown>, field: string): string {
  const value = args[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw createJsonRpcError(JSONRPC_INVALID_PARAMS, `Missing or invalid required parameter: ${field}`);
  }
  return value.trim();
}

function optionalString(args: Record<string, unknown>, field: string): string | undefined {
  const value = args[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw createJsonRpcError(JSONRPC_INVALID_PARAMS, `Invalid parameter type for ${field}: expected string`);
  }
  return value.trim() || undefined;
}

const DEFAULT_FOLDER_BY_TYPE: Record<DriveListFolderType, string> = {
  images: INBOX_FOLDER_NAME,
  csv: DEFAULT_CSV_INBOX_FOLDER,
  kindle: DEFAULT_KINDLE_DRIVE_PARENT,
};

/**
 * `drive_list_inbox_files` ツール引数を検証・正規化する。
 * @param args ツール引数オブジェクト
 * @returns 正規化された検索パラメータ
 */
export function parseListInboxArgs(args: Record<string, unknown>): {
  folderType: DriveListFolderType;
  folderName: string;
  folderId?: string;
} {
  const rawType = optionalString(args, "folderType") ?? "images";
  if (rawType !== "images" && rawType !== "csv" && rawType !== "kindle") {
    throw createJsonRpcError(JSONRPC_INVALID_PARAMS, `Invalid folderType: ${rawType}`);
  }
  const folderId = optionalString(args, "folderId");
  const folderName = optionalString(args, "folderName") ?? DEFAULT_FOLDER_BY_TYPE[rawType];
  return {
    folderType: rawType,
    folderName,
    ...(folderId ? { folderId } : {}),
  };
}

/**
 * `drive_download_file` ツール引数を検証・正規化する。
 * @param args ツール引数オブジェクト
 * @returns ファイル ID とエンコーディング
 */
export function parseDownloadFileArgs(args: Record<string, unknown>): {
  fileId: string;
  encoding: "base64" | "utf8";
} {
  const fileId = requireNonEmptyString(args, "fileId");
  const encoding = optionalString(args, "encoding") ?? "base64";
  if (encoding !== "base64" && encoding !== "utf8") {
    throw createJsonRpcError(JSONRPC_INVALID_PARAMS, `Invalid encoding: ${encoding}`);
  }
  return { fileId, encoding };
}

/**
 * `drive_mark_as_processed` ツール引数を検証・正規化する。
 * @param args ツール引数オブジェクト
 * @returns 移動・記録パラメータ
 */
export function parseMarkAsProcessedArgs(args: Record<string, unknown>): {
  fileId: string;
  inboxFolderId: string;
  processedFolderId?: string;
  processedFolderName: string;
  noteKey?: string;
} {
  const fileId = requireNonEmptyString(args, "fileId");
  const inboxFolderId = requireNonEmptyString(args, "inboxFolderId");
  const processedFolderId = optionalString(args, "processedFolderId");
  const processedFolderName = optionalString(args, "processedFolderName") ?? PROCESSED_DRIVE_FOLDER_NAME;
  const noteKey = optionalString(args, "noteKey") ?? optionalString(args, "craftDocumentId");
  return {
    fileId,
    inboxFolderId,
    ...(processedFolderId ? { processedFolderId } : {}),
    processedFolderName,
    ...(noteKey ? { noteKey } : {}),
  };
}

/**
 * `drive_cleanup_companion_texts` ツール引数を検証・正規化する。
 * @param args ツール引数オブジェクト
 * @returns クリーンアップ対象・退避先フォルダ ID
 */
export function parseCleanupCompanionTextsArgs(args: Record<string, unknown>): {
  inboxFolderId: string;
  processedFolderId?: string;
} {
  const inboxFolderId = requireNonEmptyString(args, "inboxFolderId");
  const processedFolderId = optionalString(args, "processedFolderId");
  return {
    inboxFolderId,
    ...(processedFolderId ? { processedFolderId } : {}),
  };
}
