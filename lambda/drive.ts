import path from "node:path";
import { JWT } from "google-auth-library";
import { DEFAULT_KINDLE_BOOK_PREFIX, JSON_CONTENT_TYPE } from "./const.ts";
import { isCsvFile } from "./csv.ts";
import { withFetchTimeout } from "./fetch-with-timeout.ts";
import { formatHttpErrorDetail, parseApiErrorDetail, sanitizeErrorMessage } from "./sanitize-error.ts";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
const DRIVE_API = "https://www.googleapis.com/drive/v3";

export interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  size?: string | number;
  appProperties?: Record<string, string>;
}

export type FolderResolution = { ok: true; id: string } | { ok: false; count: number };

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

export function escapeDriveQuery(value: unknown): string {
  return String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

export function isSupportedImage(file: { name?: string; mimeType?: string }): boolean {
  const mimeOk = file.mimeType === "image/jpeg" || file.mimeType === "image/png";
  const extension = path.extname(file.name ?? "").toLowerCase();
  return mimeOk && IMAGE_EXTENSIONS.has(extension);
}

export function fileStem(name?: string): string {
  const base = path.basename(name ?? "");
  const extension = path.extname(base);
  return base.slice(0, base.length - extension.length).toLowerCase();
}

export function isTextFile(file: { name?: string }): boolean {
  return path.extname(file.name ?? "").toLowerCase() === ".txt";
}

export function orphanTextFiles<T extends { name?: string }>(
  textFiles: ReadonlyArray<T>,
  remainingImages: ReadonlyArray<{ name?: string }>,
): T[] {
  const stems = new Set(remainingImages.map((file) => fileStem(file.name)));
  return textFiles.filter((file) => isTextFile(file) && !stems.has(fileStem(file.name)));
}

export function resolveUniqueFolder(files: ReadonlyArray<DriveFile>, name: string): FolderResolution {
  const matches = files.filter((file) => file.name === name && file.mimeType === FOLDER_MIME);
  if (matches.length !== 1) {
    return { ok: false, count: matches.length };
  }
  return { ok: true, id: matches[0].id };
}

export function filterKindleBookFolders<T extends { name?: string; mimeType?: string }>(
  folders: ReadonlyArray<T>,
  prefix: string = DEFAULT_KINDLE_BOOK_PREFIX,
): T[] {
  return folders.filter(
    (folder) => folder.mimeType === FOLDER_MIME && typeof folder.name === "string" && folder.name.startsWith(prefix),
  );
}

function driveUrl(pathname: string, params: Record<string, string>): URL {
  const url = new URL(`${DRIVE_API}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  const payload = text === "" ? {} : JSON.parse(text);
  if (!response.ok) {
    const message =
      typeof payload.error?.message === "string"
        ? sanitizeErrorMessage(payload.error.message)
        : parseApiErrorDetail(text).slice(0, 200) || response.statusText || String(response.status);
    throw new Error(`Drive API ${response.status}: ${message}`);
  }
  return payload;
}

export function createDriveClient({
  serviceAccount,
  authClient,
  fetchImpl = fetch,
}: {
  serviceAccount?: GoogleServiceAccount;
  authClient?: AuthClientLike;
  fetchImpl?: typeof fetch;
}): DriveClient {
  const auth: AuthClientLike =
    authClient ??
    new JWT({
      email: serviceAccount?.client_email,
      key: serviceAccount?.private_key,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });

  async function request(url: URL | string, options: RequestInit = {}): Promise<Response> {
    const access = await auth.getAccessToken();
    const token = typeof access === "string" ? access : access?.token;
    if (!token) throw new Error("Google access token was empty");
    return fetchImpl(
      url,
      withFetchTimeout({
        ...options,
        headers: {
          authorization: `Bearer ${token}`,
          ...(options.body ? { "content-type": JSON_CONTENT_TYPE } : {}),
          ...options.headers,
        },
      }),
    );
  }

  async function listAll(query: string, fields: string): Promise<DriveFile[]> {
    const files: DriveFile[] = [];
    let pageToken = "";
    do {
      const url = driveUrl("/files", {
        q: query,
        fields: `nextPageToken,files(${fields})`,
        pageSize: "100",
        supportsAllDrives: "true",
        includeItemsFromAllDrives: "true",
        ...(pageToken ? { pageToken } : {}),
      });
      const payload = await readJson(await request(url));
      files.push(...(payload.files ?? []));
      pageToken = payload.nextPageToken ?? "";
    } while (pageToken);
    return files;
  }

  return {
    async findUniqueFolder(name: string) {
      const files = await listAll(
        `name = '${escapeDriveQuery(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
        "id,name,mimeType",
      );
      return resolveUniqueFolder(files, name);
    },

    async listImages(folderId: string) {
      const files = await listAll(
        `'${folderId}' in parents and trashed = false and (mimeType = 'image/jpeg' or mimeType = 'image/png')`,
        "id,name,mimeType,size,appProperties",
      );
      return files.filter(isSupportedImage);
    },

    async listCsvFiles(folderId: string) {
      const files = await listAll(`'${folderId}' in parents and trashed = false`, "id,name,mimeType");
      return files.filter(isCsvFile);
    },

    async listTextFiles(folderId: string) {
      const files = await listAll(
        `'${folderId}' in parents and trashed = false and name contains '.txt'`,
        "id,name,mimeType",
      );
      return files.filter(isTextFile);
    },

    async download(fileId: string) {
      const url = driveUrl(`/files/${fileId}`, {
        alt: "media",
        supportsAllDrives: "true",
      });
      const response = await request(url);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Drive download ${formatHttpErrorDetail(response.status, text, response.statusText)}`);
      }
      return Buffer.from(await response.arrayBuffer());
    },

    async deleteFile(fileId: string) {
      const url = driveUrl(`/files/${fileId}`, { supportsAllDrives: "true" });
      const response = await request(url, { method: "DELETE" });
      if (response.ok) return;
      const text = await response.text();
      const message = parseApiErrorDetail(text).slice(0, 200) || response.statusText || String(response.status);
      const error = new Error(`Drive API ${response.status}: ${message}`) as Error & { status?: number };
      error.status = response.status;
      throw error;
    },

    async moveFile({ fileId, addParentId, removeParentId }) {
      const url = driveUrl(`/files/${fileId}`, {
        addParents: addParentId,
        removeParents: removeParentId,
        supportsAllDrives: "true",
        fields: "id,parents",
      });
      await readJson(await request(url, { method: "PATCH", body: "{}" }));
    },

    async moveToProcessed({ fileId, inboxFolderId, processedFolderId, craftDocumentId }) {
      const url = driveUrl(`/files/${fileId}`, {
        addParents: processedFolderId,
        removeParents: inboxFolderId,
        supportsAllDrives: "true",
        fields: "id,parents,appProperties",
      });
      await readJson(
        await request(url, {
          method: "PATCH",
          body: JSON.stringify({ appProperties: { craftDocumentId } }),
        }),
      );
    },

    async listChildFolders(parentId: string) {
      const files = await listAll(
        `'${parentId}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`,
        "id,name,mimeType",
      );
      return files;
    },

    async listKindleBookFolders(parentId: string, prefix: string = "kindle_") {
      return filterKindleBookFolders(await this.listChildFolders(parentId), prefix);
    },

    async ensureChildFolder(parentId: string, name: string) {
      const escaped = escapeDriveQuery(name);
      const files = await listAll(
        `'${parentId}' in parents and name = '${escaped}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
        "id,name,mimeType",
      );
      const resolved = resolveUniqueFolder(files, name);
      if (resolved.ok) return resolved.id;
      if (resolved.count > 1) {
        throw new Error(`Drive folder "${name}" under parent matched ${resolved.count} folders`);
      }
      const url = driveUrl("/files", { supportsAllDrives: "true", fields: "id" });
      const payload = await readJson(
        await request(url, {
          method: "POST",
          body: JSON.stringify({
            name,
            mimeType: FOLDER_MIME,
            parents: [parentId],
          }),
        }),
      );
      if (typeof payload.id !== "string" || payload.id === "") {
        throw new Error(`Drive folder "${name}" was not created`);
      }
      return payload.id;
    },
  };
}
