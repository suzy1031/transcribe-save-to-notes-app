import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type {
  CreateObsidianClientOptions,
  ObsidianClient,
  ObsidianListedNote,
  S3ObjectSummary,
} from "../../interfaces/obsidian.ts";
import { MARKDOWN_CONTENT_TYPE } from "./const.ts";
import {
  appendObsidianNoteContent,
  buildNoteKey,
  formatObsidianNote,
  listedNoteFromS3Object,
  stripFrontmatter,
} from "./helper.ts";

function isNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return err.name === "NoSuchKey" || err.Code === "NoSuchKey" || err.$metadata?.httpStatusCode === 404;
}

/**
 * S3 をバックエンドとする Obsidian Vault クライアントを生成する。
 * `bucketName` が未指定の場合はエラーを送出する。
 * @param options バケット名・リージョン・S3 クライアント実装
 * @returns `ObsidianClient` インスタンス
 */
export function createObsidianClient({ bucketName, region, s3Client }: CreateObsidianClientOptions): ObsidianClient {
  if (!bucketName) {
    throw new Error("Obsidian S3 bucket name is required");
  }
  const client = s3Client ?? new S3Client({ region });

  async function getRawNoteOrNull(key: string): Promise<string | null> {
    try {
      const output = await client.send(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: key,
        }),
      );
      if (!output?.Body) return "";
      return await output.Body.transformToString("utf-8");
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  async function putRawNote(key: string, content: string): Promise<void> {
    await client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: content,
        ContentType: MARKDOWN_CONTENT_TYPE,
      }),
    );
  }

  return {
    async createNote({ folder, title, markdown, date, tags }) {
      const key = buildNoteKey(folder, title);
      const content = formatObsidianNote({ title, markdown, date, tags });
      await putRawNote(key, content);
      return key;
    },

    async saveOrAppendNote({ folder, title, markdown, date, tags }) {
      const key = buildNoteKey(folder, title);
      const existing = await getRawNoteOrNull(key);
      const content =
        existing === null
          ? formatObsidianNote({ title, markdown, date, tags })
          : appendObsidianNoteContent(existing, markdown);
      await putRawNote(key, content);
      return key;
    },

    async listNotes({ folder, createdDateGte, createdDateLte }) {
      const cleanFolder = folder.trim().replace(/^\/+|\/+$/g, "");
      const prefix = cleanFolder ? `${cleanFolder}/` : "";
      const notes: ObsidianListedNote[] = [];
      let continuationToken: string | undefined;

      do {
        const output = await client.send(
          new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: prefix,
            ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
          }),
        );
        const contents: S3ObjectSummary[] = output?.Contents ?? [];
        for (const item of contents) {
          if (item.Key && prefix) {
            const relative = item.Key.slice(prefix.length);
            if (relative.includes("/")) continue;
          }
          const note = listedNoteFromS3Object(item);
          if (!note) continue;
          if (createdDateGte && (!note.createdDate || note.createdDate < createdDateGte)) continue;
          if (createdDateLte && (!note.createdDate || note.createdDate > createdDateLte)) continue;
          notes.push(note);
        }
        continuationToken = output?.IsTruncated ? output?.NextContinuationToken : undefined;
      } while (continuationToken);

      return notes.sort((a, b) => a.key.localeCompare(b.key));
    },

    async readMarkdown(key: string) {
      const output = await client.send(
        new GetObjectCommand({
          Bucket: bucketName,
          Key: key,
        }),
      );
      const raw = output?.Body ? await output.Body.transformToString("utf-8") : "";
      return stripFrontmatter(raw);
    },
  };
}
