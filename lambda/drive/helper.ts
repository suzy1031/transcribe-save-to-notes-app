import path from "node:path";
import { DEFAULT_KINDLE_BOOK_PREFIX, IMAGE_MIME_JPEG, IMAGE_MIME_PNG } from "../shared/const.ts";
import { parseApiErrorDetail, sanitizeErrorMessage } from "../shared/sanitize-error.ts";
import { DRIVE_API, FOLDER_MIME, IMAGE_EXTENSIONS } from "./const.ts";
import type { DriveFile, FolderResolution } from "./types.ts";

/**
 * Drive API のパスとクエリパラメータからリクエスト用 `URL` を組み立てる。
 * @param pathname `/files` などのエンドポイントパス
 * @param params クエリパラメータ
 * @returns 構築された `URL` オブジェクト
 */
export function driveUrl(pathname: string, params: Record<string, string>): URL {
  const url = new URL(`${DRIVE_API}${pathname}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

/**
 * Drive API の HTTP レスポンスを JSON として読み取る。
 * ステータスが 2xx 以外の場合は詳細メッセージをサニタイズしてエラーを送出する。
 * @param response Fetch API の `Response`
 * @returns パース済み JSON（空レスポンス時は `{}`）
 */
export async function readJson(response: Response): Promise<any> {
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

/**
 * Google Drive 検索クエリ（`q` パラメータ）向けにバックスラッシュとシングルクォートをエスケープする。
 * @param value クエリに埋め込む値
 * @returns エスケープ済み文字列
 */
export function escapeDriveQuery(value: unknown): string {
  return String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

/**
 * ファイル情報がサポート対象の画像（JPEG / PNG かつ対応拡張子）であるかを判定する。
 * @param file ファイル名と MIME タイプ
 * @returns サポート対象画像であれば `true`
 */
export function isSupportedImage(file: { name?: string; mimeType?: string }): boolean {
  const mimeOk = file.mimeType === IMAGE_MIME_JPEG || file.mimeType === IMAGE_MIME_PNG;
  const extension = path.extname(file.name ?? "").toLowerCase();
  return mimeOk && IMAGE_EXTENSIONS.has(extension);
}

/**
 * ファイル名から拡張子を除いたベース名（小文字）を返す。
 * @param name ファイル名
 * @returns 小文字の stem 文字列
 */
export function fileStem(name?: string): string {
  const base = path.basename(name ?? "");
  const extension = path.extname(base);
  return base.slice(0, base.length - extension.length).toLowerCase();
}

/**
 * ファイル拡張子が `.txt` であるかを判定する。
 * @param file ファイル名を含むオブジェクト
 * @returns `.txt` ファイルであれば `true`
 */
export function isTextFile(file: { name?: string }): boolean {
  return path.extname(file.name ?? "").toLowerCase() === ".txt";
}

/**
 * テキストファイル一覧から、対応する画像（同一 stem）が `remainingImages` に残っていない孤立テキストファイルを抽出する。
 * @param textFiles テキストファイル一覧
 * @param remainingImages 残っている画像ファイル一覧
 * @returns 対応画像が存在しないテキストファイルの配列
 */
export function orphanTextFiles<T extends { name?: string }>(
  textFiles: ReadonlyArray<T>,
  remainingImages: ReadonlyArray<{ name?: string }>,
): T[] {
  const stems = new Set(remainingImages.map((file) => fileStem(file.name)));
  return textFiles.filter((file) => isTextFile(file) && !stems.has(fileStem(file.name)));
}

/**
 * フォルダ検索結果から指定名の一意なフォルダを解決する。
 * 1 件のみ一致した場合は `{ ok: true, id }`、0 件または複数件の場合は `{ ok: false, count }` を返す。
 * @param files Drive ファイル一覧
 * @param name 対象フォルダ名
 * @returns フォルダ解決結果
 */
export function resolveUniqueFolder(files: ReadonlyArray<DriveFile>, name: string): FolderResolution {
  const matches = files.filter((file) => file.name === name && file.mimeType === FOLDER_MIME);
  if (matches.length !== 1) {
    return { ok: false, count: matches.length };
  }
  return { ok: true, id: matches[0].id };
}

/**
 * フォルダ一覧から Kindle 書籍フォルダ（指定プレフィックスで始まるフォルダ）のみを抽出する。
 * @param folders フォルダ一覧
 * @param prefix フォルダ名プレフィックス（デフォルトは `kindle_`）
 * @returns 条件に一致するフォルダの配列
 */
export function filterKindleBookFolders<T extends { name?: string; mimeType?: string }>(
  folders: ReadonlyArray<T>,
  prefix: string = DEFAULT_KINDLE_BOOK_PREFIX,
): T[] {
  return folders.filter(
    (folder) => folder.mimeType === FOLDER_MIME && typeof folder.name === "string" && folder.name.startsWith(prefix),
  );
}
