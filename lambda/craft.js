import { JSON_CONTENT_TYPE } from "./const.js";
import { withFetchTimeout } from "./fetch-with-timeout.js";

const CHILD_KEYS = ["folders", "children", "subfolders"];

export function findFolderIds(payload, name) {
  const ids = [];
  const visit = (node) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!node || typeof node !== "object") return;
    if (node.name === name && typeof node.id === "string") ids.push(node.id);
    for (const key of CHILD_KEYS) {
      if (Array.isArray(node[key])) visit(node[key]);
    }
  };
  visit(payload?.items ?? payload?.folders ?? []);
  return ids;
}

export function documentPayload(title, folderId) {
  return {
    documents: [{ title }],
    destination: { folderId },
  };
}

function createdDocumentId(payload) {
  const list = payload.items ?? payload.documents ?? [];
  const id = list[0]?.rootBlockId ?? list[0]?.id ?? list[0]?.documentId;
  if (typeof id !== "string" || id === "") {
    throw new Error("Craft document create returned no id");
  }
  return id;
}

export function documentsQuery({ folderId, createdDateGte, createdDateLte, fetchMetadata }) {
  const params = new URLSearchParams({ folderId, createdDateGte });
  if (createdDateLte) params.set("createdDateLte", createdDateLte);
  if (fetchMetadata) params.set("fetchMetadata", "true");
  return `/documents?${params.toString()}`;
}

export function listedDocument(item) {
  const id = item?.id ?? item?.documentId ?? item?.rootBlockId;
  if (typeof id !== "string" || id === "") return null;
  return { id, title: typeof item.title === "string" ? item.title : "" };
}

export function moveDocumentsPayload(documentIds, folderId) {
  return { documentIds, destination: { folderId } };
}

export function craftAppDocumentLink(spaceId, blockId) {
  const params = new URLSearchParams({
    spaceId: String(spaceId),
    blockId: String(blockId),
  });
  return `craftdocs://open?${params.toString()}`;
}

export function connectionSpaceId(payload) {
  const id = payload?.space?.id ?? payload?.space?.spaceId;
  if (typeof id !== "string" || id === "") {
    throw new Error("Craft connection returned no space id");
  }
  return id;
}

async function craftRequest(baseUrl, apiKey, path, { method, body, fetchImpl, accept = JSON_CONTENT_TYPE }) {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const response = await fetchImpl(
    url,
    withFetchTimeout({
      method,
      headers: {
        accept,
        authorization: `Bearer ${apiKey}`,
        ...(body === undefined ? {} : { "content-type": JSON_CONTENT_TYPE }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Craft ${method} ${path} failed: ${response.status} ${text.slice(0, 300)}`);
  }
  if (accept !== JSON_CONTENT_TYPE) return text;
  return text === "" ? {} : JSON.parse(text);
}

export function createCraftClient({ baseUrl, apiKey, fetchImpl = fetch }) {
  if (!apiKey) throw new Error("Craft API key is required");
  const request = (path, options) => craftRequest(baseUrl, apiKey, path, { ...options, fetchImpl });
  return {
    async getConnection() {
      return request("/connection", { method: "GET" });
    },

    async findFolder(name) {
      const listed = await request("/folders", { method: "GET" });
      const ids = findFolderIds(listed, name);
      if (ids.length > 1) {
        throw new Error(`Craft folder "${name}" matched ${ids.length} folders`);
      }
      return ids[0] ?? null;
    },

    async ensureFolder(name) {
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
      const listed = await request(
        documentsQuery({ folderId, createdDateGte, createdDateLte, fetchMetadata }),
        { method: "GET" },
      );
      const items = listed.items ?? listed.documents ?? [];
      return items.map(listedDocument).filter((item) => item !== null);
    },

    async readMarkdown(id) {
      return request(`/blocks?id=${encodeURIComponent(id)}`, {
        method: "GET",
        accept: "text/markdown",
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
