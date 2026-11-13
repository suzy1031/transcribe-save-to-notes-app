export interface CraftListedDocument {
  id: string;
  title: string;
}

export interface DocumentsQueryParams {
  folderId: string;
  createdDateGte: string;
  createdDateLte?: string;
  fetchMetadata?: boolean;
}

export interface CraftClient {
  getConnection(): Promise<unknown>;
  findFolder(name: string): Promise<string | null>;
  ensureFolder(name: string): Promise<string>;
  createDocument(input: { title: string; markdown: string; folderId: string }): Promise<string>;
  appendMarkdown(input: { pageId: string; markdown: string }): Promise<void>;
  listDocuments(params: DocumentsQueryParams): Promise<CraftListedDocument[]>;
  readMarkdown(id: string): Promise<string>;
  moveDocuments(input: { documentIds: string[]; folderId: string }): Promise<void>;
}
