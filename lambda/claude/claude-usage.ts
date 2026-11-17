import { type AttributeValue, DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { TOKYO_TIME_ZONE } from "../shared/const.ts";
import { estimateUsdMicros, microToUsdDecimal, normalizeUsage } from "./claude-pricing.ts";
import type {
  DynamoLike,
  GetWeeklyUsageOptions,
  NormalizedUsage,
  RecordWeeklyUsageOptions,
  WeeklyUsageItem,
} from "./types.ts";

const FUNCTION_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

function tokyoDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

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

function numberAttribute(value: number): AttributeValue {
  return { N: String(value) };
}

function zeroSlice(): AttributeValue {
  return {
    M: {
      callCount: numberAttribute(0),
      inputTokens: numberAttribute(0),
      outputTokens: numberAttribute(0),
      cacheReadInputTokens: numberAttribute(0),
      cacheCreationInputTokens: numberAttribute(0),
      estimatedUsd: { N: microToUsdDecimal(0) },
    },
  };
}

async function ensureByFunction(dynamo: DynamoLike, tableName: string, pk: string): Promise<void> {
  await dynamo.send(
    new UpdateItemCommand({
      TableName: tableName,
      Key: { pk: { S: pk } },
      UpdateExpression: "SET #byFunction = if_not_exists(#byFunction, :empty)",
      ExpressionAttributeNames: { "#byFunction": "byFunction" },
      ExpressionAttributeValues: { ":empty": { M: {} } },
    }),
  );
}

async function ensureFunctionSlice(
  dynamo: DynamoLike,
  tableName: string,
  pk: string,
  functionName: string,
): Promise<void> {
  await dynamo.send(
    new UpdateItemCommand({
      TableName: tableName,
      Key: { pk: { S: pk } },
      UpdateExpression: "SET #byFunction.#fn = if_not_exists(#byFunction.#fn, :zero)",
      ExpressionAttributeNames: { "#byFunction": "byFunction", "#fn": functionName },
      ExpressionAttributeValues: { ":zero": zeroSlice() },
    }),
  );
}

function addUsageCommand({
  tableName,
  pk,
  functionName,
  tokens,
  micros,
}: {
  tableName: string;
  pk: string;
  functionName: string;
  tokens: NormalizedUsage;
  micros: number;
}): UpdateItemCommand {
  return new UpdateItemCommand({
    TableName: tableName,
    Key: { pk: { S: pk } },
    UpdateExpression: [
      "ADD callCount :one, inputTokens :input, outputTokens :output,",
      "cacheReadInputTokens :cacheRead, cacheCreationInputTokens :cacheCreate, estimatedUsd :usd,",
      "#byFunction.#fn.#callCount :one, #byFunction.#fn.#input :input, #byFunction.#fn.#output :output,",
      "#byFunction.#fn.#cacheRead :cacheRead, #byFunction.#fn.#cacheCreate :cacheCreate, #byFunction.#fn.#usd :usd",
    ].join(" "),
    ExpressionAttributeNames: {
      "#byFunction": "byFunction",
      "#fn": functionName,
      "#callCount": "callCount",
      "#input": "inputTokens",
      "#output": "outputTokens",
      "#cacheRead": "cacheReadInputTokens",
      "#cacheCreate": "cacheCreationInputTokens",
      "#usd": "estimatedUsd",
    },
    ExpressionAttributeValues: {
      ":one": numberAttribute(1),
      ":input": numberAttribute(tokens.inputTokens),
      ":output": numberAttribute(tokens.outputTokens),
      ":cacheRead": numberAttribute(tokens.cacheReadInputTokens),
      ":cacheCreate": numberAttribute(tokens.cacheCreationInputTokens),
      ":usd": { N: microToUsdDecimal(micros) },
    },
  });
}

function dynamoClient(dynamo?: DynamoLike): DynamoLike {
  return dynamo ?? new DynamoDBClient({});
}

function documentClient(document?: DynamoLike, dynamo?: DynamoLike): DynamoLike {
  if (document) return document;
  return DynamoDBDocumentClient.from(dynamoClient(dynamo) as DynamoDBClient);
}

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

function toAmount(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function usdText(value: unknown): string {
  return toAmount(value).toFixed(3);
}

function jpyText(usdValue: unknown, rate: number): string {
  return `約${(toAmount(usdValue) * rate).toFixed(1)}円`;
}

function formatCount(value: unknown): string {
  const count = Number(value ?? 0);
  if (!Number.isFinite(count) || count < 0) return "0";
  return Math.floor(count).toLocaleString("en-US");
}

function validRate(rate?: number | null): number | null {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : null;
}

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
