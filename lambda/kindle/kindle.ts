import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { createDriveClient } from "../drive/drive.ts";
import type { DriveClient } from "../drive/types.ts";
import { bunLambdaHandler } from "../shared/bun-handler.ts";
import {
  DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID,
  DEFAULT_KINDLE_BOOK_PREFIX,
  DEFAULT_KINDLE_DRIVE_PARENT,
  DEFAULT_KINDLE_PROCESSED_FOLDER,
  DEFAULT_MCP_DOMAIN_NAME,
  DEFAULT_OBSIDIAN_KINDLE_FOLDER,
  MAX_TRANSCRIPTION_TOKENS,
  MIN_REMAINING_MS,
} from "../shared/const.ts";
import { runLogged } from "../shared/job.ts";
import {
  buildMcpServerDefinitions,
  callClaudeMessages,
  imageMediaType,
  requireAnthropicApiKey,
} from "../shared/llm.ts";
import { sanitizeErrorMessage } from "../shared/sanitize-error.ts";
import { loadCredentials, requireMcpAuthToken, settingsFromEnv } from "../shared/settings.ts";
import type { Credentials, LambdaContextLike } from "../shared/types.ts";
import { KINDLE_SYSTEM_PROMPT, KINDLE_USER_PROMPT } from "./kindle-prompt.ts";
import type { KindleSettings, ProcessKindleResult } from "./types.ts";

export function kindleSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): KindleSettings {
  return {
    ...settingsFromEnv(env),
    driveParentFolderName: env.KINDLE_DRIVE_PARENT_FOLDER_NAME || DEFAULT_KINDLE_DRIVE_PARENT,
    bookFolderPrefix: env.KINDLE_BOOK_FOLDER_PREFIX || DEFAULT_KINDLE_BOOK_PREFIX,
    processedFolderName: env.KINDLE_PROCESSED_FOLDER_NAME || DEFAULT_KINDLE_PROCESSED_FOLDER,
    obsidianKindleFolder: env.OBSIDIAN_KINDLE_FOLDER || DEFAULT_OBSIDIAN_KINDLE_FOLDER,
    kindleClaudeModelId: env.KINDLE_CLAUDE_MODEL_ID || env.CLAUDE_MODEL_ID || DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID,
  };
}

export async function runKindleWithMcp({
  context,
  settings = kindleSettingsFromEnv(),
  credentials,
  drive: driveClient,
  rootDomain = process.env.MCP_DOMAIN_NAME || DEFAULT_MCP_DOMAIN_NAME,
  fetchImpl = fetch,
  recordUsage,
}: {
  context: LambdaContextLike;
  settings?: KindleSettings;
  credentials?: Credentials;
  drive?: DriveClient;
  rootDomain?: string;
  fetchImpl?: typeof fetch;
  recordUsage?: Parameters<typeof callClaudeMessages>[0]["recordUsage"];
}): Promise<ProcessKindleResult> {
  const creds =
    credentials ?? (await loadCredentials(settings, new SecretsManagerClient({ region: settings.bedrockRegion })));
  const mcpAuthToken = requireMcpAuthToken(creds);
  const drive = driveClient ?? createDriveClient({ serviceAccount: creds.serviceAccount });
  const parent = await drive.findUniqueFolder(settings.driveParentFolderName);
  if (!parent.ok) {
    const reason = `Drive folder lookup failed: kindle=${parent.count}`;
    console.error(reason);
    return { foldersScanned: 0, imagesSummarized: 0, imagesFailed: 0, folderLookup: "failed" };
  }

  const bookFolders = await drive.listKindleBookFolders(parent.id, settings.bookFolderPrefix);
  const mcpServers = buildMcpServerDefinitions({
    domains: ["obsidian", "drive", "line"],
    authToken: mcpAuthToken,
    rootDomain,
  });
  const apiKey = requireAnthropicApiKey(creds.anthropicApiKey);

  const result: Required<Omit<ProcessKindleResult, "folderLookup">> = {
    foldersScanned: bookFolders.length,
    imagesSummarized: 0,
    imagesFailed: 0,
    deferred: 0,
    errors: [],
    links: [],
  };

  for (let folderIndex = 0; folderIndex < bookFolders.length; folderIndex += 1) {
    const bookFolder = bookFolders[folderIndex];
    if (context.getRemainingTimeInMillis() < MIN_REMAINING_MS) {
      result.deferred += bookFolders.length - folderIndex;
      break;
    }
    const images = await drive.listImages(bookFolder.id);
    if (images.length === 0) continue;

    const processedFolderId = await drive.ensureChildFolder(bookFolder.id, settings.processedFolderName);
    for (let index = 0; index < images.length; index += 1) {
      const file = images[index];
      if (context.getRemainingTimeInMillis() < MIN_REMAINING_MS) {
        result.deferred += images.length - index;
        break;
      }
      try {
        const bytes = await drive.download(file.id);
        const instruction = [
          KINDLE_USER_PROMPT,
          `対象書籍フォルダ: title="${bookFolder.name}", file="${file.name}", fileId="${file.id}", bookFolderId="${bookFolder.id}", processedFolderId="${processedFolderId}".`,
          `1. 要約した Markdown を obsidian_save_or_append_note（folder="${settings.obsidianKindleFolder}", title="${bookFolder.name}", tags=["kindle"]）で保存・追記し、key と appLink を取得してください。`,
          `2. drive_mark_as_processed（fileId="${file.id}", inboxFolderId="${bookFolder.id}", processedFolderId="${processedFolderId}", noteKey=<取得したkey>）で処理済みフォルダへ移動してください。`,
          `3. 移動後、line_send_notification で "Kindle要約完了: ${bookFolder.name} (${file.name})\\n<appLink>" を送信してください。`,
        ].join("\n");

        await callClaudeMessages({
          apiKey,
          modelId: settings.kindleClaudeModelId,
          maxTokens: MAX_TRANSCRIPTION_TOKENS,
          system: KINDLE_SYSTEM_PROMPT,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: imageMediaType(file.mimeType),
                    data: Buffer.from(bytes).toString("base64"),
                  },
                },
                { type: "text", text: instruction },
              ],
            },
          ],
          mcpServers,
          functionName: "kindle",
          errorPrefix: "Claude MCP kindle summary failed",
          fetchImpl,
          ...(recordUsage ? { recordUsage } : {}),
        });
        result.imagesSummarized += 1;
      } catch (error) {
        result.imagesFailed += 1;
        const message = sanitizeErrorMessage((error as Error).message);
        result.errors.push(`${bookFolder.name}/${file.name}: ${message}`);
        console.error(`Kindle MCP要約失敗 ${bookFolder.name}/${file.name}: ${message}`);
      }
    }
  }

  console.log(`Kindle要約 ${result.imagesSummarized}枚 失敗 ${result.imagesFailed}枚`);
  return result;
}

export async function handler(_event: unknown, context: LambdaContextLike): Promise<ProcessKindleResult> {
  return runLogged(() => runKindleWithMcp({ context }));
}

export default bunLambdaHandler(handler);
