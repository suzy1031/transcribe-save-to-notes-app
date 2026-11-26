import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { DriveClient } from "../../interfaces/drive.ts";
import type { ProcessInboxSummary } from "../../interfaces/inbox.ts";
import type { BaseSettings, Credentials, LambdaContextLike } from "../../interfaces/shared.ts";
import { bunLambdaHandler } from "../../shared/bun-handler.ts";
import {
  DEFAULT_MCP_DOMAIN_NAME,
  INBOX_FOLDER_NAME,
  MAX_IMAGE_BYTES,
  MAX_TRANSCRIPTION_TOKENS,
  MIN_REMAINING_MS,
  PROCESSED_DRIVE_FOLDER_NAME,
  TRANSCRIBE_USER_PROMPT,
} from "../../shared/const.ts";
import { createDriveClient } from "../../shared/drive/drive.ts";
import { runLogged } from "../../shared/job.ts";
import {
  buildMcpServerDefinitions,
  callClaudeMessages,
  imageMediaType,
  requireAnthropicApiKey,
} from "../../shared/llm.ts";
import { sanitizeErrorMessage } from "../../shared/sanitize-error.ts";
import { loadCredentials, settingsFromEnv } from "../../shared/settings.ts";
import { SYSTEM_PROMPT } from "../../shared/transcribe/prompt.ts";

export async function runInboxWithMcp({
  context,
  settings = settingsFromEnv(),
  credentials,
  drive: driveClient,
  rootDomain = process.env.MCP_DOMAIN_NAME || DEFAULT_MCP_DOMAIN_NAME,
  fetchImpl = fetch,
  recordUsage,
  maxImageBytes = MAX_IMAGE_BYTES,
}: {
  context: LambdaContextLike;
  settings?: BaseSettings;
  credentials?: Credentials;
  drive?: DriveClient;
  rootDomain?: string;
  fetchImpl?: typeof fetch;
  recordUsage?: Parameters<typeof callClaudeMessages>[0]["recordUsage"];
  maxImageBytes?: number;
}): Promise<ProcessInboxSummary> {
  const creds =
    credentials ?? (await loadCredentials(settings, new SecretsManagerClient({ region: settings.bedrockRegion })));
  const mcpAuthToken = (creds.mcpAuthToken ?? "").trim();
  if (!mcpAuthToken) {
    throw new Error("mcpAuthToken is required");
  }
  const drive = driveClient ?? createDriveClient({ serviceAccount: creds.serviceAccount });
  const inbox = await drive.findUniqueFolder(INBOX_FOLDER_NAME);
  const processed = await drive.findUniqueFolder(PROCESSED_DRIVE_FOLDER_NAME);
  const summary: ProcessInboxSummary = { processed: 0, failed: 0, skipped: 0, deferred: 0 };
  if (!inbox.ok || !processed.ok) {
    const inboxCount = inbox.ok ? 1 : inbox.count;
    const processedCount = processed.ok ? 1 : processed.count;
    console.error(`画像ファイル取得失敗 inbox=${inboxCount} processed=${processedCount}`);
    return { ...summary, folderLookup: "failed" };
  }

  const files = await drive.listImages(inbox.id);
  if (files.length === 0) {
    console.info("画像ファイル取得なし");
    return summary;
  }

  const mcpServers = buildMcpServerDefinitions({
    domains: ["obsidian", "drive", "line"],
    authToken: mcpAuthToken,
    rootDomain,
  });
  const apiKey = requireAnthropicApiKey(creds.anthropicApiKey);

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (context.getRemainingTimeInMillis() < MIN_REMAINING_MS) {
      summary.deferred += files.length - index;
      console.info(`Deferred ${summary.deferred} file(s): remaining time is under 60 seconds`);
      break;
    }
    try {
      const listedSize = file.size != null && file.size !== "" ? Number(file.size) : Number.NaN;
      if (Number.isFinite(listedSize) && listedSize > maxImageBytes) {
        summary.skipped += 1;
        console.error(`Skipped ${file.name}: image exceeds the size limit`);
        continue;
      }
      const bytes = await drive.download(file.id);
      if (bytes.byteLength > maxImageBytes) {
        summary.skipped += 1;
        console.error(`Skipped ${file.name}: image exceeds the size limit`);
        continue;
      }
      const isLast = index === files.length - 1;
      const instruction = [
        TRANSCRIBE_USER_PROMPT,
        `対象ファイル: name="${file.name}", fileId="${file.id}", inboxFolderId="${inbox.id}", processedFolderId="${processed.id}".`,
        `1. 画像を文字起こしし、obsidian_save_or_append_note（folder="${settings.obsidianDailyFolder}", tags=["daily"]）で保存して key と appLink を取得してください。`,
        `2. drive_mark_as_processed（fileId="${file.id}", inboxFolderId="${inbox.id}", processedFolderId="${processed.id}", noteKey=<取得したkey>）で処理済みへ移動してください。`,
        `3. line_send_notification でタイトルと appLink を改行区切りで LINE 通知してください。`,
        ...(isLast
          ? [
              `4. 最後に drive_cleanup_companion_texts（inboxFolderId="${inbox.id}", processedFolderId="${processed.id}"）を実行してください。`,
            ]
          : []),
      ].join("\n");

      await callClaudeMessages({
        apiKey,
        modelId: settings.claudeModelId,
        maxTokens: MAX_TRANSCRIPTION_TOKENS,
        system: SYSTEM_PROMPT,
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
        functionName: "index",
        errorPrefix: "Claude MCP inbox transcription failed",
        fetchImpl,
        ...(recordUsage ? { recordUsage } : {}),
      });
      summary.processed += 1;
    } catch (error) {
      summary.failed += 1;
      console.error(`MCP文字起こし失敗 ${file.name}: ${sanitizeErrorMessage((error as Error).message)}`);
    }
  }
  return summary;
}

export async function handler(_event: unknown, context: LambdaContextLike): Promise<ProcessInboxSummary> {
  return runLogged(() => runInboxWithMcp({ context }));
}

export default bunLambdaHandler(handler);
