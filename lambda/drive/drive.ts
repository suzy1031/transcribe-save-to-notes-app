import { JWT } from "google-auth-library";
import { isCsvFile } from "../csv/csv.ts";
import { JSON_CONTENT_TYPE } from "../shared/const.ts";
import { withFetchTimeout } from "../shared/fetch-with-timeout.ts";
import { formatHttpErrorDetail, parseApiErrorDetail, sanitizeErrorMessage } from "../shared/sanitize-error.ts";
import {
  escapeDriveQuery,
  FOLDER_MIME,
  filterKindleBookFolders,
  isSupportedImage,
  isTextFile,
  resolveUniqueFolder,
} from "./helper.ts";
import type { AuthClientLike, DriveClient, DriveFile, GoogleServiceAccount } from "./types.ts";

const DRIVE_API = "https://www.googleapis.com/drive/v3";

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
