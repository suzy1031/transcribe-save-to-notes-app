import { obsidianAppNoteLink } from "../obsidian/helper.ts";
import { sanitizeErrorMessage } from "../shared/sanitize-error.ts";
import {
  JSONRPC_INTERNAL_ERROR,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
  JSONRPC_PARSE_ERROR,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  OBSIDIAN_MCP_TOOLS,
  OBSIDIAN_RESOURCE_TEMPLATES,
} from "./const.ts";
import {
  createJsonRpcError,
  formatToolResult,
  isRecord,
  jsonRpcError,
  jsonRpcSuccess,
  parseJsonRpcRequest,
  parseListNotesArgs,
  parseObsidianNoteUri,
  parseSaveNoteArgs,
} from "./helper.ts";
import type { CreateObsidianMcpServerOptions, JsonRpcResponse, McpToolCallResult, ObsidianMcpServer } from "./types.ts";

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
      default:
        throw createJsonRpcError(JSONRPC_METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  async function handleMessage(message: unknown): Promise<JsonRpcResponse | null> {
    const rawId =
      isRecord(message) && (typeof message.id === "string" || typeof message.id === "number") ? message.id : null;
    let request: ReturnType<typeof parseJsonRpcRequest>;
    try {
      request = parseJsonRpcRequest(message);
    } catch (error) {
      const err = error as Error & { code?: number };
      return jsonRpcError(rawId, err.code ?? JSONRPC_INVALID_REQUEST, err.message);
    }
    if (!request) {
      return jsonRpcError(rawId, JSONRPC_INVALID_REQUEST, "Invalid Request");
    }

    // `id` が指定されていないメッセージは JSON-RPC Notification として扱う
    if (request.id === undefined) {
      return null;
    }

    try {
      const result = await dispatchMethod(request.method, request.params);
      return jsonRpcSuccess(request.id, result);
    } catch (error) {
      const err = error as Error & { code?: number };
      const code = typeof err.code === "number" ? err.code : JSONRPC_INTERNAL_ERROR;
      return jsonRpcError(request.id, code, sanitizeErrorMessage(err.message));
    }
  }

  async function handlePayload(payload: unknown): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
    if (Array.isArray(payload)) {
      if (payload.length === 0) {
        return jsonRpcError(null, JSONRPC_INVALID_REQUEST, "Invalid Request: empty batch");
      }
      const responses: JsonRpcResponse[] = [];
      for (const item of payload) {
        const res = await handleMessage(item);
        if (res !== null) responses.push(res);
      }
      return responses.length > 0 ? responses : null;
    }
    return handleMessage(payload);
  }

  async function handleHttpRequest(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return Response.json(
        jsonRpcError(null, JSONRPC_INVALID_REQUEST, "Method Not Allowed: use POST for MCP requests"),
        { status: 405 },
      );
    }
    const text = await request.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return Response.json(jsonRpcError(null, JSONRPC_PARSE_ERROR, "Parse error"), { status: 400 });
    }
    const result = await handlePayload(payload);
    if (result === null) {
      return new Response(null, { status: 202 });
    }
    return Response.json(result, { status: 200 });
  }

  return {
    handleMessage,
    handlePayload,
    handleHttpRequest,
  };
}
