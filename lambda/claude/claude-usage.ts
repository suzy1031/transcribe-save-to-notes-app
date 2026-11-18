import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { TOKYO_TIME_ZONE } from "../shared/const.ts";
import { estimateUsdMicros, microToUsdDecimal, normalizeUsage } from "./claude-pricing.ts";
import { FUNCTION_NAME } from "./const.ts";
import {
  addUsageCommand,
  documentClient,
  dynamoClient,
  ensureByFunction,
  ensureFunctionSlice,
  formatCount,
  jpyText,
  tokyoDate,
  usdText,
  validRate,
} from "./helper.ts";
import type { GetWeeklyUsageOptions, NormalizedUsage, RecordWeeklyUsageOptions, WeeklyUsageItem } from "./types.ts";

/**
 * 指定日時・タイムゾーンから DynamoDB 用の ISO 週パーティションキー（`WEEK#YYYY-Www`）を生成する。
 * @param now 対象日時（デフォルトは現在時刻）
 * @param timeZone IANA タイムゾーン名（デフォルトは東京時間）
 * @returns `WEEK#YYYY-Www` 形式のパーティションキー
 */
export function isoWeekKey(now: Date = new Date(), timeZone: string = TOKYO_TIME_ZONE): string {
  const [year, month, day] = tokyoDate(now, timeZone).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `WEEK#${isoYear}-W${String(week).padStart(2, "0")}`;
}

/**
 * Claude API のトークン使用量と推定コストを DynamoDB の週次集計レコードに加算記録する。
 * `tableName` が未設定の場合は何もせず `null` を返す。
 * @param options 関数名・モデル ID・usage・テーブル名などのオプション
 * @returns 記録されたキー・トークン数・推定 USD 文字列、またはスキップ時は `null`
 */
export async function recordWeeklyUsage(
  {
    functionName,
    modelId = "",
    usage,
    tableName = process.env.CLAUDE_USAGE_TABLE_NAME ?? "",
    dynamo,
    now = new Date(),
  }: RecordWeeklyUsageOptions = { modelId: "" },
): Promise<(NormalizedUsage & { pk: string; estimatedUsd: string }) | null> {
  if (!tableName) return null;
  if (!FUNCTION_NAME.test(functionName ?? "")) throw new Error(`Invalid functionName: ${functionName}`);
  const validFunctionName = functionName as string;
  const { micros, priced, tokens } = estimateUsdMicros(modelId, usage);
  if (!priced) console.warn(`Claude pricing is unknown for model ${modelId}`);
  const pk = isoWeekKey(now);
  const client = dynamoClient(dynamo);
  await ensureByFunction(client, tableName, pk);
  await ensureFunctionSlice(client, tableName, pk, validFunctionName);
  await client.send(addUsageCommand({ tableName, pk, functionName: validFunctionName, tokens, micros }));
  return { pk, ...tokens, estimatedUsd: microToUsdDecimal(micros) };
}

/**
 * 指定された週の Claude 利用量集計アイテムを DynamoDB から整合性読み込みで取得する。
 * `tableName` が未設定の場合は `null` を返す。
 * @param options テーブル名・クライアント・対象日時・パーティションキーなどのオプション
 * @returns 週次利用量アイテム、または存在しない場合・未設定時は `null`
 */
export async function getWeeklyUsage({
  tableName = process.env.CLAUDE_USAGE_TABLE_NAME ?? "",
  dynamo,
  document,
  now = new Date(),
  pk = isoWeekKey(now),
}: GetWeeklyUsageOptions = {}): Promise<WeeklyUsageItem | null> {
  if (!tableName) return null;
  const result = await documentClient(document, dynamo).send(
    new GetCommand({
      TableName: tableName,
      Key: { pk },
      ConsistentRead: true,
    }),
  );
  return (result.Item as WeeklyUsageItem | undefined) ?? null;
}

/**
 * 週次利用量アイテムを LINE 通知向けの日本語サマリー文字列に整形する。
 * @param item 週次利用量アイテム
 * @param usdJpyRate 任意の USD/JPY 為替レート（無効または未指定時はドル表記のみ）
 * @returns 整形された週次利用量レポート文字列
 */
export function formatWeeklyUsage(item: WeeklyUsageItem | null | undefined, usdJpyRate?: number | null): string {
  if (!item) return "Claude利用量: 当週の記録はありません";
  const rate = validRate(usdJpyRate);
  const weekLabel = item.pk.replace(/^WEEK#/, "");
  const totalUsd = usdText(item.estimatedUsd);
  const totalLine =
    rate !== null
      ? `合計: ${jpyText(item.estimatedUsd, rate)} ($${totalUsd}) ※1ドル=${rate.toFixed(1)}円`
      : `合計: $${totalUsd} (円換算取得失敗)`;
  const lines = [
    `Claude利用量 (${weekLabel})`,
    totalLine,
    `${formatCount(item.callCount)}回 / 入力 ${formatCount(item.inputTokens)} / 出力 ${formatCount(item.outputTokens)} tok`,
  ];
  const byFunction = item.byFunction ?? {};
  for (const name of ["index", "weekly", "kindle"]) {
    const row = byFunction[name];
    if (!row) continue;
    const rowUsd = usdText(row.estimatedUsd);
    const calls = formatCount(row.callCount);
    lines.push(
      rate !== null
        ? `- ${name}: ${jpyText(row.estimatedUsd, rate)} ($${rowUsd} / ${calls}回)`
        : `- ${name}: $${rowUsd} (${calls}回)`,
    );
  }
  return lines.join("\n");
}

export { normalizeUsage };
