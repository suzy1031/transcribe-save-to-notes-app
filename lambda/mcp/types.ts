import type { ObsidianClient } from "../obsidian/types.ts";
import type { SecretsClientLike } from "../shared/types.ts";

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export interface McpToolInputSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: ReadonlyArray<string>;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: McpToolInputSchema;
}

export interface McpResourceTemplate {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpTextContent {
  type: "text";
  text: string;
}

export interface McpToolCallResult {
  content: McpTextContent[];
  isError?: boolean;
}

export interface CreateObsidianMcpServerOptions {
  obsidian: ObsidianClient;
  vaultName?: string;
}

export interface ObsidianMcpServer {
  handleMessage(message: unknown): Promise<JsonRpcResponse | null>;
  handlePayload(payload: unknown): Promise<JsonRpcResponse | JsonRpcResponse[] | null>;
  handleHttpRequest(request: Request): Promise<Response>;
}

export interface CreateMcpFetchHandlerOptions {
  server?: ObsidianMcpServer;
  resolveAuthToken?: () => Promise<string>;
  env?: NodeJS.ProcessEnv;
  secretsClient?: SecretsClientLike;
}
