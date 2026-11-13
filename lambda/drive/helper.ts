import path from "node:path";
import { DEFAULT_KINDLE_BOOK_PREFIX } from "../shared/const.ts";
import type { DriveFile, FolderResolution } from "./types.ts";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);

export const FOLDER_MIME = "application/vnd.google-apps.folder";

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
