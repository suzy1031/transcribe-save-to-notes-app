import path from "node:path";
import { JWT } from "google-auth-library";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
const DRIVE_API = "https://www.googleapis.com/drive/v3";

export function isSupportedImage(file) {
  const mimeOk = file.mimeType === "image/jpeg" || file.mimeType === "image/png";
  const extension = path.extname(file.name ?? "").toLowerCase();
  return mimeOk && IMAGE_EXTENSIONS.has(extension);
}

export function fileStem(name) {
  const base = path.basename(name ?? "");
  const extension = path.extname(base);
  return base.slice(0, base.length - extension.length).toLowerCase();
}

export function isTextFile(file) {
  return path.extname(file.name ?? "").toLowerCase() === ".txt";
}

export function orphanTextFiles(textFiles, remainingImages) {
  const stems = new Set(remainingImages.map((file) => fileStem(file.name)));
  return textFiles.filter((file) => isTextFile(file) && !stems.has(fileStem(file.name)));
}

export function resolveUniqueFolder(files, name) {
  const matches = files.filter(
    (file) => file.name === name && file.mimeType === FOLDER_MIME,
  );
  if (matches.length !== 1) {
    return { ok: false, count: matches.length };
  }
  return { ok: true, id: matches[0].id };
}

function driveUrl(pathname, params) {
  const url = new URL(`${DRIVE_API}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

async function readJson(response) {
  const text = await response.text();
  const payload = text === "" ? {} : JSON.parse(text);
  if (!response.ok) {
    const message = payload.error?.message ?? text.slice(0, 300);
    throw new Error(`Drive API ${response.status}: ${message}`);
  }
  return payload;
}

export function createDriveClient({ serviceAccount, fetchImpl = fetch }) {
  const auth = new JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  async function request(url, options = {}) {
    const access = await auth.getAccessToken();
    const token = typeof access === "string" ? access : access?.token;
    if (!token) throw new Error("Google access token was empty");
    return fetchImpl(url, {
      ...options,
      headers: {
        authorization: `Bearer ${token}`,
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...options.headers,
      },
    });
  }

  async function listAll(query, fields) {
    const files = [];
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
    async findUniqueFolder(name) {
      const files = await listAll(
        `name = '${name.replaceAll("'", "\\'")}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
        "id,name,mimeType",
      );
      return resolveUniqueFolder(files, name);
    },

    async listImages(folderId) {
      const files = await listAll(
        `'${folderId}' in parents and trashed = false and (mimeType = 'image/jpeg' or mimeType = 'image/png')`,
        "id,name,mimeType,appProperties",
      );
      return files.filter(isSupportedImage);
    },

    async listTextFiles(folderId) {
      const files = await listAll(
        `'${folderId}' in parents and trashed = false and name contains '.txt'`,
        "id,name,mimeType",
      );
      return files.filter(isTextFile);
    },

    async download(fileId) {
      const url = driveUrl(`/files/${fileId}`, {
        alt: "media",
        supportsAllDrives: "true",
      });
      const response = await request(url);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Drive download ${response.status}: ${text.slice(0, 300)}`);
      }
      return Buffer.from(await response.arrayBuffer());
    },

    async deleteFile(fileId) {
      const url = driveUrl(`/files/${fileId}`, { supportsAllDrives: "true" });
      const response = await request(url, { method: "DELETE" });
      if (response.ok) return;
      const text = await response.text();
      let message = text.slice(0, 300);
      try {
        message = JSON.parse(text).error?.message ?? message;
      } catch {
        // Keep the raw response excerpt.
      }
      const error = new Error(`Drive API ${response.status}: ${message}`);
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
  };
}
