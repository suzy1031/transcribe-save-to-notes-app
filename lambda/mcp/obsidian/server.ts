import { obsidianAppNoteLink } from "../../obsidian/helper.ts";
import { sanitizeErrorMessage } from "../../shared/sanitize-error.ts";
import {
  createJsonRpcError,
  createMcpServerTransport,
  formatToolResult,
  isRecord,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_METHOD_NOT_FOUND,
} from "../jsonrpc.ts";
import type { CreateObsidianMcpServerOptions, McpToolCallResult, ObsidianMcpServer } from "../types.ts";
import {
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  OBSIDIAN_MCP_PROMPTS,
  OBSIDIAN_MCP_TOOLS,
  OBSIDIAN_RESOURCE_TEMPLATES,
} from "./const.ts";
import { buildObsidianPromptResult, parseListNotesArgs, parseObsidianNoteUri, parseSaveNoteArgs } from "./helper.ts";

/**
 * Obsidian (S3 Vault) ドメインの操作を MCP (Model Context Protocol) として公開するサーバーを生成する。
 * @param options `obsidian` クライアントおよびデフォルトの `vaultName`
 * @returns `ObsidianMcpServer` インスタンス
 */
export function createObsidianMcpServer({
  obsidian,
  vaultName = "",
}: CreateObsidianMcpServerOptions): ObsidianMcpServer {
  async function executeTool(name: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    switch (name) {
      case "obsidian_create_note": {
        const input = parseSaveNoteArgs(args);
        const key = await obsidian.createNote(input);
        const appLink = vaultName ? obsidianAppNoteLink(vaultName, key) : "";
        return formatToolResult({ key, ...(appLink ? { appLink } : {}) });
      }
      case "obsidian_save_or_append_note": {
        const input = parseSaveNoteArgs(args);
        const key = await obsidian.saveOrAppendNote(input);
        const appLink = vaultName ? obsidianAppNoteLink(vaultName, key) : "";
        return formatToolResult({ key, ...(appLink ? { appLink } : {}) });
      }
      case "obsidian_list_notes": {
        const params = parseListNotesArgs(args);
        const notes = await obsidian.listNotes(params);
        return formatToolResult({ notes });
      }
      case "obsidian_read_note": {
        const key = typeof args.key === "string" ? args.key.trim() : "";
        if (!key) {
          throw createJsonRpcError(JSONRPC_INVALID_PARAMS, "Missing or invalid required parameter: key");
        }
        const markdown = await obsidian.readMarkdown(key);
        return formatToolResult(markdown);
      }
      case "obsidian_get_app_link": {
        const key = typeof args.key === "string" ? args.key.trim() : "";
        if (!key) {
          throw createJsonRpcError(JSONRPC_INVALID_PARAMS, "Missing or invalid required parameter: key");
        }
        const targetVault =
          typeof args.vaultName === "string" && args.vaultName.trim() !== "" ? args.vaultName.trim() : vaultName;
        if (!targetVault) {
          throw createJsonRpcError(JSONRPC_INVALID_PARAMS, "Missing or invalid required parameter: vaultName");
        }
        const appLink = obsidianAppNoteLink(targetVault, key);
        return formatToolResult({ key, vaultName: targetVault, appLink });
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
            : MCP_PROTOCOL_VERSION;
        return {
          protocolVersion: requestedVersion,
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
          },
          serverInfo: {
            name: MCP_SERVER_NAME,
            version: MCP_SERVER_VERSION,
          },
        };
      }
      case "ping":
        return {};
      case "tools/list":
        return { tools: OBSIDIAN_MCP_TOOLS };
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
      case "resources/list":
        return { resources: [] };
      case "resources/templates/list":
        return { resourceTemplates: OBSIDIAN_RESOURCE_TEMPLATES };
      case "resources/read": {
        const uri = params.uri;
        const key = parseObsidianNoteUri(uri);
        const markdown = await obsidian.readMarkdown(key);
        return {
          contents: [
            {
              uri: String(uri),
              mimeType: "text/markdown",
              text: markdown,
            },
          ],
        };
      }
      case "prompts/list":
        return { prompts: OBSIDIAN_MCP_PROMPTS };
      case "prompts/get": {
        const name = typeof params.name === "string" ? params.name.trim() : "";
        if (!name) {
          throw createJsonRpcError(JSONRPC_INVALID_PARAMS, "Missing prompt name");
        }
        const rawArgs = params.arguments ?? {};
        if (!isRecord(rawArgs)) {
          throw createJsonRpcError(JSONRPC_INVALID_PARAMS, "Invalid prompt arguments: expected an object");
        }
        return buildObsidianPromptResult(name, rawArgs);
      }
      default:
        throw createJsonRpcError(JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  return createMcpServerTransport(dispatchMethod);
}
