import type { CraftListedDocument, DocumentsQueryParams } from "./types.ts";

const CHILD_KEYS = ["folders", "children", "subfolders"] as const;

export function findFolderIds(payload: any, name: string): string[] {
  const ids: string[] = [];
  const visit = (node: any): void => {
    const isFolderList = Array.isArray(node);
    if (isFolderList) {
      for (const item of node) visit(item);
      return;
    }

    const isFolder = node != null && typeof node === "object";
    if (!isFolder) return;

    const hasRequestedName = node.name === name;
    const hasStringId = typeof node.id === "string";
    if (hasRequestedName && hasStringId) ids.push(node.id);

    for (const key of CHILD_KEYS) {
      const nestedFolders = node[key];
      const hasNestedFolders = Array.isArray(nestedFolders);
      if (hasNestedFolders) visit(nestedFolders);
    }
  };
  visit(payload?.items ?? payload?.folders ?? []);
  return ids;
}

export function documentPayload(
  title: string,
  folderId: string,
): { documents: Array<{ title: string }>; destination: { folderId: string } } {
  return {
    documents: [{ title }],
    destination: { folderId },
  };
}

export function createdDocumentId(payload: any): string {
  const list = payload.items ?? payload.documents ?? [];
  const id = list[0]?.rootBlockId ?? list[0]?.id ?? list[0]?.documentId;
  const isStringId = typeof id === "string";
  const isEmptyId = id === "";
  if (!isStringId || isEmptyId) {
    throw new Error("Craft document create returned no id");
  }
  return id;
}

export function documentsQuery({
  folderId,
  createdDateGte,
  createdDateLte,
  fetchMetadata,
}: DocumentsQueryParams): string {
  const params = new URLSearchParams({ folderId, createdDateGte });
  if (createdDateLte) params.set("createdDateLte", createdDateLte);
  if (fetchMetadata) params.set("fetchMetadata", "true");
  return `/documents?${params.toString()}`;
}

export function listedDocument(item: any): CraftListedDocument | null {
  const id = item?.id ?? item?.documentId ?? item?.rootBlockId;
  if (typeof id !== "string" || id === "") return null;
  return { id, title: typeof item.title === "string" ? item.title : "" };
}

export function moveDocumentsPayload(
  documentIds: string[],
  folderId: string,
): { documentIds: string[]; destination: { folderId: string } } {
  return { documentIds, destination: { folderId } };
}

export function craftAppDocumentLink(spaceId: unknown, blockId: unknown): string {
  const params = new URLSearchParams({
    spaceId: String(spaceId),
    blockId: String(blockId),
  });
  return `craftdocs://open?${params.toString()}`;
}

export function connectionSpaceId(payload: any): string {
  const id = payload?.space?.id ?? payload?.space?.spaceId;
  if (typeof id !== "string" || id === "") {
    throw new Error("Craft connection returned no space id");
  }
  return id;
}
