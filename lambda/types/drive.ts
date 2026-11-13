export interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  size?: string | number;
  appProperties?: Record<string, string>;
}

export type FolderResolution =
  | { ok: true; id: string }
  | { ok: false; count: number };

export interface GoogleServiceAccount {
  client_email?: string;
  private_key?: string;
}

export interface AuthClientLike {
  getAccessToken(): Promise<string | { token?: string | null } | null | undefined>;
}

export interface DriveClient {
  findUniqueFolder(name: string): Promise<FolderResolution>;
  listImages(folderId: string): Promise<DriveFile[]>;
  listCsvFiles(folderId: string): Promise<DriveFile[]>;
  listTextFiles(folderId: string): Promise<DriveFile[]>;
  download(fileId: string): Promise<Buffer>;
  deleteFile(fileId: string): Promise<void>;
  moveFile(input: { fileId: string; addParentId: string; removeParentId: string }): Promise<void>;
  moveToProcessed(input: {
    fileId: string;
    inboxFolderId: string;
    processedFolderId: string;
    craftDocumentId: string;
  }): Promise<void>;
  listChildFolders(parentId: string): Promise<DriveFile[]>;
  listKindleBookFolders(parentId: string, prefix?: string): Promise<DriveFile[]>;
  ensureChildFolder(parentId: string, name: string): Promise<string>;
}
