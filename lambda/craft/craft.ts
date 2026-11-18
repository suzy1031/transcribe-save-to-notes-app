import { TEXT_MARKDOWN_CONTENT_TYPE } from "./const.ts";
import {
  craftRequest,
  createdDocumentId,
  documentPayload,
  documentsQuery,
  findFolderIds,
  listedDocument,
  moveDocumentsPayload,
} from "./helper.ts";
import type { CraftClient, CraftListedDocument, CreateCraftClientOptions } from "./types.ts";

/**
 * Craft API クライアントを生成する。
 * `apiKey` が未指定の場合はエラーを送出する。
 * @param options ベース URL・API キー・fetch 実装などのオプション
 * @returns `CraftClient` インスタンス
 */
export function createCraftClient({ baseUrl = "", apiKey, fetchImpl = fetch }: CreateCraftClientOptions): CraftClient {
  if (!apiKey) throw new Error("Craft API key is required");
  const request = (path: string, options: { method: string; body?: unknown; accept?: string }) =>
    craftRequest(baseUrl, apiKey, path, { ...options, fetchImpl });
  return {
    async getConnection() {
      return request("/connection", { method: "GET" });
    },

    async findFolder(name: string) {
      const listed = await request("/folders", { method: "GET" });
      const ids = findFolderIds(listed, name);
      if (ids.length > 1) {
        throw new Error(`Craft folder "${name}" matched ${ids.length} folders`);
      }
      return ids[0] ?? null;
    },

    async ensureFolder(name: string) {
      const listed = await request("/folders", { method: "GET" });
      const ids = findFolderIds(listed, name);
      if (ids.length > 1) {
        throw new Error(`Craft folder "${name}" matched ${ids.length} folders`);
      }
      if (ids.length === 1) return ids[0];
      const created = await request("/folders", {
        method: "POST",
        body: { folders: [{ name }] },
      });
      const createdIds = findFolderIds(created, name);
      if (createdIds.length === 1) return createdIds[0];
      const list = created.items ?? created.folders ?? [];
      if (createdIds.length === 0 && list.length === 1 && typeof list[0]?.id === "string") {
        return list[0].id;
      }
      throw new Error(`Craft folder "${name}" was not created`);
    },

    async createDocument({ title, markdown, folderId }) {
      const created = await request("/documents", {
        method: "POST",
        body: documentPayload(title, folderId),
      });
      const documentId = createdDocumentId(created);
      await this.appendMarkdown({ pageId: documentId, markdown });
      return documentId;
    },

    async appendMarkdown({ pageId, markdown }) {
      await request("/blocks", {
        method: "POST",
        body: {
          markdown,
          position: { position: "end", pageId },
        },
      });
    },

    async listDocuments({ folderId, createdDateGte, createdDateLte, fetchMetadata }) {
      const listed = await request(documentsQuery({ folderId, createdDateGte, createdDateLte, fetchMetadata }), {
        method: "GET",
      });
      const items: unknown[] = listed.items ?? listed.documents ?? [];
      return items.map(listedDocument).filter((item): item is CraftListedDocument => item !== null);
    },

    async readMarkdown(id: string) {
      return request(`/blocks?id=${encodeURIComponent(id)}`, {
        method: "GET",
        accept: TEXT_MARKDOWN_CONTENT_TYPE,
      });
    },

    async moveDocuments({ documentIds, folderId }) {
      await request("/documents/move", {
        method: "PUT",
        body: moveDocumentsPayload(documentIds, folderId),
      });
    },
  };
}
