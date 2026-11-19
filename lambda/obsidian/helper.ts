import { tokyoDate } from "../shared/tokyo-date.ts";
import { MARKDOWN_EXTENSION } from "./const.ts";
import type { ObsidianListedNote, S3ObjectSummary } from "./types.ts";

/**
 * ノートタイトルを Obsidian Vault 内のファイル名（拡張子なし）に正規化する。
 * ファイル名に使用できない `/` は `-` に置換する。
 * @param title 元のノートタイトル
 * @returns 正規化されたファイル名（拡張子なし）
 */
export function sanitizeNoteFileName(title: string): string {
  const sanitized = String(title ?? "")
    .trim()
    .replace(/\//g, "-");
  if (!sanitized) {
    throw new Error("Obsidian note title is required");
  }
  return sanitized;
}

/**
 * フォルダ名とノートタイトルから S3 オブジェクトキー（Vault 相対パス）を生成する。
 * @param folder Vault 内のフォルダ名
 * @param title ノートタイトル
 * @returns `{folder}/{sanitizedTitle}.md` 形式のキー
 */
export function buildNoteKey(folder: string, title: string): string {
  const cleanFolder = String(folder ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "");
  const fileName = `${sanitizeNoteFileName(title)}${MARKDOWN_EXTENSION}`;
  return cleanFolder ? `${cleanFolder}/${fileName}` : fileName;
}

/**
 * タイトルまたはファイル名に含まれる日付（`YYYY-MM-DD` または `YYYY/MM/DD`）を `YYYY-MM-DD` 形式で抽出する。
 * @param title ノートタイトルまたはファイル名
 * @returns `YYYY-MM-DD` 形式の日付文字列、見つからない場合は `undefined`
 */
export function deriveNoteDateFromTitle(title: string): string | undefined {
  const match = String(title ?? "").match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return undefined;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/**
 * Craft の `<highlight ...>...</highlight>` タグが含まれている場合に Obsidian の `==...==` 記法へ変換する。
 * @param markdown 変換対象の Markdown 本文
 * @returns 変換後の Markdown 本文
 */
export function convertCraftHighlightsToObsidian(markdown: string): string {
  return String(markdown ?? "").replace(/<highlight\b[^>]*>([\s\S]*?)<\/highlight>/gi, (_, inner: string) => {
    return `==${inner.trim()}==`;
  });
}

function escapeYamlDoubleQuoted(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Obsidian ノートの YAML frontmatter を生成する。
 * @param options `title`, `date`, `tags`
 * @returns `---` で囲まれた YAML frontmatter
 */
export function formatObsidianFrontmatter({
  title,
  date,
  tags = [],
}: {
  title: string;
  date?: string;
  tags?: ReadonlyArray<string>;
}): string {
  const resolvedDate = date ?? deriveNoteDateFromTitle(title);
  const lines = ["---", `title: "${escapeYamlDoubleQuoted(title.trim())}"`];
  if (resolvedDate) {
    lines.push(`date: ${resolvedDate}`);
  }
  if (tags.length > 0) {
    lines.push("tags:");
    for (const tag of tags) {
      lines.push(`  - ${tag}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

/**
 * Obsidian Flavored Markdown ノート全文（YAML frontmatter + 本文）を生成する。
 * @param options `title`, `markdown`, `date`, `tags`
 * @returns 完成した Markdown 文字列
 */
export function formatObsidianNote({
  title,
  markdown,
  date,
  tags = [],
}: {
  title: string;
  markdown: string;
  date?: string;
  tags?: ReadonlyArray<string>;
}): string {
  const frontmatter = formatObsidianFrontmatter({ title, date, tags });
  const body = convertCraftHighlightsToObsidian(markdown).trim();
  return body ? `${frontmatter}\n\n${body}\n` : `${frontmatter}\n`;
}

/**
 * 既存の Obsidian ノート全文に新しい Markdown ブロックを末尾追記する。
 * @param existingContent 既存ノートの全文
 * @param markdown 追記する Markdown 本文
 * @returns 追記後のノート全文
 */
export function appendObsidianNoteContent(existingContent: string, markdown: string): string {
  const addition = convertCraftHighlightsToObsidian(markdown).trim();
  if (!addition) return existingContent;
  const trimmedExisting = String(existingContent ?? "").trimEnd();
  return `${trimmedExisting}\n\n${addition}\n`;
}

/**
 * Obsidian ノートから先頭の YAML frontmatter を取り除き、本文のみを返す。
 * @param content ノート全文
 * @returns frontmatter を除いた Markdown 本文
 */
export function stripFrontmatter(content: string): string {
  const text = String(content ?? "");
  const match = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/);
  return (match ? text.slice(match[0].length) : text).trim();
}

/**
 * S3 オブジェクト概要から `ObsidianListedNote` を生成する。
 * `.md` ファイルでない場合は `null` を返す。
 * @param item S3 オブジェクト概要
 * @returns 正規化されたノート情報、または `null`
 */
export function listedNoteFromS3Object(item: S3ObjectSummary): ObsidianListedNote | null {
  const key = item.Key ?? "";
  if (!key || key.endsWith("/") || !key.endsWith(MARKDOWN_EXTENSION)) {
    return null;
  }
  const baseName = key.split("/").pop() ?? "";
  const title = baseName.slice(0, -MARKDOWN_EXTENSION.length);
  if (!title) return null;
  const createdDate =
    deriveNoteDateFromTitle(title) ?? (item.LastModified instanceof Date ? tokyoDate(item.LastModified) : "");
  return {
    id: key,
    key,
    title,
    createdDate,
  };
}

/**
 * Obsidian アプリで該当ノートを開くためのディープリンク URL (`obsidian://open?...`) を生成する。
 * @param vaultName Obsidian Vault 名
 * @param noteKey Vault 内のノートパス（`.md` の有無は問わない）
 * @returns Obsidian アプリ用ディープリンク URL
 */
export function obsidianAppNoteLink(vaultName: unknown, noteKey: unknown): string {
  const vault = String(vaultName ?? "").trim();
  const file = String(noteKey ?? "")
    .trim()
    .replace(/\.md$/i, "");
  if (!vault || !file) return "";
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(file)}`;
}
