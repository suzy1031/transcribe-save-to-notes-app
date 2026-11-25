import { orphanTextFiles } from "../../drive/helper.ts";
import type { DriveClient } from "../../drive/types.ts";
import { DEFAULT_KINDLE_BOOK_PREFIX } from "../../shared/const.ts";
import { sanitizeErrorMessage } from "../../shared/sanitize-error.ts";
import {
  createJsonRpcError,
  createMcpServerTransport,
  formatToolResult,
  isRecord,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_METHOD_NOT_FOUND,
} from "../jsonrpc.ts";
import type { CreateDriveMcpServerOptions, McpServer, McpToolCallResult } from "../types.ts";
import {
  DRIVE_MCP_PROTOCOL_VERSION,
  DRIVE_MCP_SERVER_NAME,
  DRIVE_MCP_SERVER_VERSION,
  DRIVE_MCP_TOOLS,
} from "./const.ts";
import {
  parseCleanupCompanionTextsArgs,
  parseDownloadFileArgs,
  parseListInboxArgs,
  parseMarkAsProcessedArgs,
} from "./helper.ts";

/**
 * Google Drive ドメインの操作を MCP (Model Context Protocol) として公開するサーバーを生成する。
 * @param options `drive` クライアントまたは遅延解決関数 `resolveDrive`
 * @returns `McpServer` インスタンス
 */
export function createDriveMcpServer({ drive, resolveDrive }: CreateDriveMcpServerOptions): McpServer {
  let cachedDrive: DriveClient | undefined = drive;

  async function getDrive(): Promise<DriveClient> {
    if (!cachedDrive) {
      if (!resolveDrive) {
        throw new Error("createDriveMcpServer requires either drive or resolveDrive");
      }
      cachedDrive = await resolveDrive();
    }
    return cachedDrive;
  }

  async function resolveUniqueFolderId(client: DriveClient, folderName: string): Promise<string> {
    const resolved = await client.findUniqueFolder(folderName);
    if (!resolved.ok) {
      throw new Error(`Drive folder "${folderName}" matched ${resolved.count} folders (expected 1)`);
    }
    return resolved.id;
  }

  async function executeTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const client = await getDrive();

    switch (name) {
      case "drive_list_inbox_files": {
        const { folderType, folderName, folderId } = parseListInboxArgs(args);
        const targetFolderId = folderId ?? (await resolveUniqueFolderId(client, folderName));
        if (folderType === "csv") {
          const files = await client.listCsvFiles(targetFolderId);
          return formatToolResult({ folderId: targetFolderId, folderType, files });
        }
        if (folderType === "kindle") {
          const folders = await client.listKindleBookFolders(targetFolderId, DEFAULT_KINDLE_BOOK_PREFIX);
          return formatToolResult({ folderId: targetFolderId, folderType, folders });
        }
        const files = await client.listImages(targetFolderId);
        return formatToolResult({ folderId: targetFolderId, folderType, files });
      }
      case "drive_download_file": {
        const { fileId, encoding } = parseDownloadFileArgs(args);
        const buf = await client.download(fileId);
        return formatToolResult({
          fileId,
          encoding,
          byteLength: buf.byteLength,
          content: buf.toString(encoding),
        });
      }
      case "drive_mark_as_processed": {
        const { fileId, inboxFolderId, processedFolderId, processedFolderName, noteKey } =
          parseMarkAsProcessedArgs(args);
        const targetProcessedId = processedFolderId ?? (await resolveUniqueFolderId(client, processedFolderName));
        if (noteKey) {
          await client.moveToProcessed({
            fileId,
            inboxFolderId,
            processedFolderId: targetProcessedId,
            craftDocumentId: noteKey,
          });
        } else {
          await client.moveFile({
            fileId,
            addParentId: targetProcessedId,
            removeParentId: inboxFolderId,
          });
        }
        return formatToolResult({
          fileId,
          inboxFolderId,
          processedFolderId: targetProcessedId,
          ...(noteKey ? { noteKey } : {}),
          moved: true,
        });
      }
      case "drive_cleanup_companion_texts": {
        const { inboxFolderId, processedFolderId } = parseCleanupCompanionTextsArgs(args);
        const [textFiles, remainingImages] = await Promise.all([
          client.listTextFiles(inboxFolderId),
          client.listImages(inboxFolderId),
        ]);
        const orphans = orphanTextFiles(textFiles, remainingImages);
        const deleted: string[] = [];
        const moved: string[] = [];
        for (const file of orphans) {
          try {
            await client.deleteFile(file.id);
            deleted.push(file.id);
          } catch (error) {
            const err = error as Error & { status?: number };
            if (err.status === 403 && processedFolderId) {
              await client.moveFile({
                fileId: file.id,
                addParentId: processedFolderId,
                removeParentId: inboxFolderId,
              });
              moved.push(file.id);
            } else {
              throw error;
            }
          }
        }
        return formatToolResult({ deleted, moved });
      }
      default:
        throw createJsonRpcError(JSONRPC_INVALID_PARAMS, `Unknown tool: ${name}`);
    }
  }

  async function dispatchMethod(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    switch (method) {
      case "initialize": {
        const requestedVersion =
          typeof params.protocolVersion === "string" && params.protocolVersion.trim() !== ""
            ? params.protocolVersion
            : DRIVE_MCP_PROTOCOL_VERSION;
        return {
          protocolVersion: requestedVersion,
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: DRIVE_MCP_SERVER_NAME,
            version: DRIVE_MCP_SERVER_VERSION,
          },
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return { tools: DRIVE_MCP_TOOLS };
      case "tools/call": {
        const name = typeof params.name === "string" ? params.name.trim() : "";
        if (!name) {
          throw createJsonRpcError(JSONRPC_INVALID_PARAMS, "Missing tool name");
        }
        const rawArgs = params.arguments ?? {};
        if (!isRecord(rawArgs)) {
          throw createJsonRpcError(JSONRPC_INVALID_PARAMS, "Invalid tool arguments: expected an object");
        }
        try {
          return await executeTool(name, rawArgs);
        } catch (error) {
          const err = error as Error & { code?: number };
          if (typeof err.code === "number") throw err;
          return formatToolResult(`Tool execution failed: ${sanitizeErrorMessage(err.message)}`, true);
        }
      }
      default:
        throw createJsonRpcError(JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  return createMcpServerTransport(dispatchMethod);
}
