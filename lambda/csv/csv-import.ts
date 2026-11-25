import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { csvImportSummaryMessage, EMPTY_CSV_MESSAGE } from "../line/helper.ts";
import { bunLambdaHandler } from "../shared/bun-handler.ts";
import {
  ALL_NOTES_SINCE,
  DEFAULT_CLAUDE_WEEKLY_MODEL_ID,
  DEFAULT_CSV_INBOX_FOLDER,
  DEFAULT_CSV_PROCESSED_FOLDER,
  DEFAULT_MCP_DOMAIN_NAME,
  DEFAULT_OBSIDIAN_HOUSEHOLD_BUDGET_FOLDER,
  MAX_SUMMARY_TOKENS,
} from "../shared/const.ts";
import { runLogged } from "../shared/job.ts";
import { buildMcpServerDefinitions, callClaudeMessages, requireAnthropicApiKey } from "../shared/llm.ts";
import { loadCredentials, requireMcpAuthToken, settingsFromEnv } from "../shared/settings.ts";
import { tokyoDate } from "../shared/tokyo-date.ts";
import type { Credentials } from "../shared/types.ts";
import {
  appendCashTotalRow,
  appendDebitTotalRow,
  appendTotalRow,
  parseCsv,
  rowsToMarkdownTable,
  sheetTitle,
} from "./csv.ts";
import { rowsWithCumulative } from "./helper.ts";
import type { CsvImportResult, CsvImportSettings, ImportCsvFilesOptions } from "./types.ts";

/**
 * 環境変数から CSV 取り込み用の設定（受信フォルダ名・処理済みフォルダ名・保存先フォルダ等）を構築する。
 * @param env 環境変数オブジェクト（デフォルトは `process.env`）
 * @returns CSV 取り込み設定
 */
export function csvImportSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): CsvImportSettings {
  return {
    ...settingsFromEnv(env),
    inboxFolderName: env.CSV_INBOX_FOLDER_NAME || DEFAULT_CSV_INBOX_FOLDER,
    processedFolderName: env.CSV_PROCESSED_FOLDER_NAME || DEFAULT_CSV_PROCESSED_FOLDER,
    householdBudgetFolder: env.OBSIDIAN_HOUSEHOLD_BUDGET_FOLDER || DEFAULT_OBSIDIAN_HOUSEHOLD_BUDGET_FOLDER,
  };
}

/**
 * 指定された CSV ファイル群をダウンロード・集計して Markdown テーブルとして S3 へ保存し、処理済みフォルダへ移動して LINE 通知する。
 * @param options ファイル一覧・I/O コールバック・通知関数・基準日時などのオプション
 * @returns 取り込み件数・失敗件数・失敗詳細を含む実行結果
 */
export async function importCsvFiles({
  files,
  download,
  existingNoteTitles,
  readNoteRows,
  writeNote,
  moveToProcessed,
  pushLine,
  buildNoteLink,
  now = new Date(),
}: ImportCsvFilesOptions): Promise<CsvImportResult> {
  if (files.length === 0) {
    await pushLine(EMPTY_CSV_MESSAGE);
    return { imported: 0, failed: 0, failures: [] };
  }

  const titles = new Set(existingNoteTitles.map((title) => title.toLowerCase()));
  const knownTitles = [...existingNoteTitles];
  const date = tokyoDate(now);
  const result: CsvImportResult = { imported: 0, failed: 0, failures: [] };
  const noteLinks: string[] = [];

  for (const file of files) {
    const title = sheetTitle({ date, fileName: file.name });
    if (titles.has(title.toLowerCase())) {
      result.failed += 1;
      result.failures.push({
        fileName: file.name,
        reason: `ノート「${title}」は既にあります`,
      });
      continue;
    }

    let noteKey = "";
    try {
      const bytes = await download(file);
      const text = Buffer.from(bytes).toString("utf8");
      const parsed = parseCsv(text);
      const weekly = appendCashTotalRow(appendDebitTotalRow(appendTotalRow(parsed)));
      const rows = await rowsWithCumulative(weekly, title, knownTitles, readNoteRows);
      const markdown = rowsToMarkdownTable(rows);
      noteKey = await writeNote({ title, date, markdown });
      titles.add(title.toLowerCase());
      knownTitles.push(title);
    } catch (error) {
      result.failed += 1;
      result.failures.push({ fileName: file.name, reason: (error as Error).message });
      continue;
    }

    try {
      await moveToProcessed(file);
      result.imported += 1;
      const link = buildNoteLink?.(noteKey);
      if (link) noteLinks.push(link);
    } catch (error) {
      result.failed += 1;
      result.failures.push({
        fileName: file.name,
        reason: `ノートは作成済みです。移動に失敗しました: ${(error as Error).message}`,
      });
    }
  }

  await pushLine(
    csvImportSummaryMessage({
      imported: result.imported,
      failed: result.failed,
      noteLinks,
      failures: result.failures,
    }),
  );
  return result;
}

export async function runCsvImportWithMcp({
  settings = csvImportSettingsFromEnv(),
  credentials,
  rootDomain = process.env.MCP_DOMAIN_NAME || DEFAULT_MCP_DOMAIN_NAME,
  now = new Date(),
  fetchImpl = fetch,
  recordUsage,
}: {
  settings?: CsvImportSettings;
  credentials?: Credentials;
  rootDomain?: string;
  now?: Date;
  fetchImpl?: typeof fetch;
  recordUsage?: Parameters<typeof callClaudeMessages>[0]["recordUsage"];
} = {}): Promise<{ responseText: string }> {
  const creds =
    credentials ?? (await loadCredentials(settings, new SecretsManagerClient({ region: settings.bedrockRegion })));
  const mcpAuthToken = requireMcpAuthToken(creds);
  const today = tokyoDate(now);
  const mcpServers = buildMcpServerDefinitions({
    domains: ["drive", "csv", "obsidian", "line"],
    authToken: mcpAuthToken,
    rootDomain,
  });

  const userPrompt = [
    `今日は ${today} です。Google Drive の "${settings.inboxFolderName}" フォルダにある CSV ファイルを取り込んで Obsidian の "${settings.householdBudgetFolder}" フォルダへ保存し、LINE 通知してください。`,
    `1. drive_list_inbox_files（folderType="csv", folderName="${settings.inboxFolderName}"）で CSV 一覧と inboxFolderId を取得してください。`,
    `2. CSV が 0 件の場合は line_send_notification で "${EMPTY_CSV_MESSAGE}" を送信して終了してください。`,
    `3. CSV がある場合は obsidian_list_notes（folder="${settings.householdBudgetFolder}", createdDateGte="${ALL_NOTES_SINCE}"）で既存ノート一覧を取得してください。`,
    `4. 各 CSV について drive_download_file（encoding="utf8"）で内容を取得し、タイトル "<today>_<ファイル名(拡張子なし)>" の同名ノートが既にあればスキップしてください。月次累計計算に必要な同月の過去ノートがあれば obsidian_read_note で読み取り、household_format_csv_to_markdown で Markdown テーブルを生成してください。`,
    `5. 生成した Markdown を obsidian_create_note（folder="${settings.householdBudgetFolder}", date="${today}", tags=["household-budget"]）で保存し、drive_mark_as_processed（processedFolderName="${settings.processedFolderName}", noteKey=<取得したkey>）で移動してください。`,
    `6. 最後に成功件数・失敗件数・appLink を line_send_notification で送信してください。`,
  ].join("\n");

  const responseText = await callClaudeMessages({
    apiKey: requireAnthropicApiKey(creds.anthropicApiKey),
    modelId: process.env.CLAUDE_MODEL_ID || DEFAULT_CLAUDE_WEEKLY_MODEL_ID,
    maxTokens: MAX_SUMMARY_TOKENS,
    system:
      "あなたは家計簿 CSV 取り込みの実行担当です。指示された手順どおりに MCP ツールを呼び出して処理してください。",
    messages: [{ role: "user", content: userPrompt }],
    mcpServers,
    functionName: "index",
    errorPrefix: "Claude MCP csv import failed",
    fetchImpl,
    ...(recordUsage ? { recordUsage } : {}),
  });
  return { responseText };
}

/**
 * CSV 取り込み Lambda のエントリポイントハンドラー。
 * @param _event Lambda イベント
 * @param _context Lambda コンテキスト
 * @returns 実行結果
 */
export async function handler(_event: unknown, _context: unknown): Promise<{ responseText: string }> {
  return runLogged(() => runCsvImportWithMcp());
}

export default bunLambdaHandler(handler);
