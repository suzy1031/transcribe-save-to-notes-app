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
  const id = list[0]?.id ?? list[0]?.documentId;
  if (typeof id !== "string" || id === "") {
    throw new Error("Craft document create returned no id");
  }
  return id;
}

async function craftJson(baseUrl, apiKey, path, { method, body, fetchImpl }) {
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  const response = await fetchImpl(url, {
    method,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Craft ${method} ${path} failed: ${response.status} ${text.slice(0, 300)}`);
  }
  return text === "" ? {} : JSON.parse(text);
}

export function createCraftClient({ baseUrl, apiKey, fetchImpl = fetch }) {
  if (!apiKey) throw new Error("Craft API key is required");
  const request = (path, options) => craftJson(baseUrl, apiKey, path, { ...options, fetchImpl });
  return {
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
      await request("/blocks", {
        method: "POST",
        body: {
          markdown,
          position: { position: "end", pageId: documentId },
        },
      });
      return documentId;
    },
  };
}
