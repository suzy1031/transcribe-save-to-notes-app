import { JSON_CONTENT_TYPE } from "../shared/const.ts";
import { withFetchTimeout } from "../shared/fetch-with-timeout.ts";
import { formatHttpErrorDetail } from "../shared/sanitize-error.ts";
import { CHILD_KEYS } from "./const.ts";
import type { CraftListedDocument, CraftRequestOptions, DocumentsQueryParams } from "./types.ts";

/**
 * Craft API へ HTTP リクエストを送信し、レスポンスを JSON またはテキストとして返す。
 * ステータスが 2xx 以外の場合は整形済みエラーを送出する。
 * @param baseUrl Craft API のベース URL
 * @param apiKey Craft API キー
 * @param path エンドポイントパス
 * @param options メソッド・ボディ・fetch 実装・Accept ヘッダーなどのオプション
 * @returns パース済み JSON、空レスポンス時は `{}`、または非 JSON 指定時はレスポンステキスト
 */
export async function craftRequest(
  baseUrl: string,
  apiKey: string,
  path: string,
  { method, body, fetchImpl, accept = JSON_CONTENT_TYPE }: CraftRequestOptions,
): Promise<any> {
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
    throw new Error(
      `Craft ${method} ${path} failed: ${formatHttpErrorDetail(response.status, text, response.statusText)}`,
    );
  }
  if (accept !== JSON_CONTENT_TYPE) return text;
  return text === "" ? {} : JSON.parse(text);
}

/**
 * 値が有効な文字列 ID でない（文字列でない、または空文字）場合に `true` を返す。
 * @param id 判定対象の ID 値
 * @returns 無効な ID であれば `true`
 */
function isMissingId(id: unknown): boolean {
  const isStringId = typeof id === "string";
  const isEmptyId = id === "";
  return !isStringId || isEmptyId;
}

/**
 * フォルダ一覧ペイロードを再帰的に走査し、指定したフォルダ名に一致するすべてのフォルダ ID を返す。
 * @param payload Craft `/folders` API のレスポンスペイロード
 * @param name 検索するフォルダ名
 * @returns 一致したフォルダ ID の配列
 */
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

/**
 * ドキュメント作成 API (`/documents`) 用のリクエストボディを生成する。
 * @param title ドキュメントタイトル
 * @param folderId 保存先フォルダ ID
 * @returns リクエストボディオブジェクト
 */
export function documentPayload(
  title: string,
  folderId: string,
): { documents: Array<{ title: string }>; destination: { folderId: string } } {
  return {
    documents: [{ title }],
    destination: { folderId },
  };
}

/**
 * ドキュメント作成 API のレスポンスから作成されたドキュメント ID を抽出する。
 * ID が取得できない場合はエラーを送出する。
 * @param payload Craft `POST /documents` のレスポンスペイロード
 * @returns 作成されたドキュメント ID
 */
export function createdDocumentId(payload: any): string {
  const list = payload.items ?? payload.documents ?? [];
  const id = list[0]?.rootBlockId ?? list[0]?.id ?? list[0]?.documentId;
  if (isMissingId(id)) {
    throw new Error("Craft document create returned no id");
  }
  return id;
}

/**
 * ドキュメント一覧取得 API (`/documents`) 用のクエリ付きパスを生成する。
 * @param params フォルダ ID・作成日範囲・メタデータ取得フラグ
 * @returns クエリ文字列を含むパス
 */
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

/**
 * ドキュメント一覧レスポンスの 1 要素を `CraftListedDocument` に正規化する。
 * ID が欠落している場合は `null` を返す。
 * @param item レスポンス配列の 1 要素
 * @returns 正規化されたドキュメント情報、または `null`
 */
export function listedDocument(item: any): CraftListedDocument | null {
  const id = item?.id ?? item?.documentId ?? item?.rootBlockId;
  if (isMissingId(id)) return null;

  const hasStringTitle = typeof item.title === "string";
  const title = hasStringTitle ? item.title : "";
  return { id, title };
}

/**
 * ドキュメント移動 API (`/documents/move`) 用のリクエストボディを生成する。
 * @param documentIds 移動対象のドキュメント ID 配列
 * @param folderId 移動先フォルダ ID
 * @returns リクエストボディオブジェクト
 */
export function moveDocumentsPayload(
  documentIds: string[],
  folderId: string,
): { documentIds: string[]; destination: { folderId: string } } {
  return { documentIds, destination: { folderId } };
}

/**
 * Craft アプリで該当ドキュメントを開くためのディープリンク URL (`craftdocs://open?...`) を生成する。
 * @param spaceId Craft スペース ID
 * @param blockId 対象ブロックまたはドキュメントの ID
 * @returns Craft アプリ用ディープリンク URL
 */
export function craftAppDocumentLink(spaceId: unknown, blockId: unknown): string {
  const params = new URLSearchParams({
    spaceId: String(spaceId),
    blockId: String(blockId),
  });
  return `craftdocs://open?${params.toString()}`;
}

/**
 * Craft `/connection` API のレスポンスからスペース ID を抽出する。
 * ID が取得できない場合はエラーを送出する。
 * @param payload Craft `GET /connection` のレスポンスペイロード
 * @returns スペース ID
 */
export function connectionSpaceId(payload: any): string {
  const id = payload?.space?.id ?? payload?.space?.spaceId;
  if (isMissingId(id)) {
    throw new Error("Craft connection returned no space id");
  }
  return id;
}
