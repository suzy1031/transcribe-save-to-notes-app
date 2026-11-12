import { type AttributeValue, DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import {
  estimateUsdMicros,
  microToUsdDecimal,
  type NormalizedUsage,
  normalizeUsage,
  type RawClaudeUsage,
} from "./claude-pricing.ts";
import { TOKYO_TIME_ZONE } from "./const.ts";

const FUNCTION_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

export interface DynamoLike {
  send(command: unknown): Promise<any>;
}

export interface WeeklyUsageFunctionRow {
  callCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  estimatedUsd?: number | string;
}

export interface WeeklyUsageItem extends WeeklyUsageFunctionRow {
  pk: string;
  byFunction?: Record<string, WeeklyUsageFunctionRow>;
}

export interface RecordWeeklyUsageOptions {
  functionName?: string;
  modelId: string;
  usage?: RawClaudeUsage;
  tableName?: string;
  dynamo?: DynamoLike;
  now?: Date;
}

export interface GetWeeklyUsageOptions {
  tableName?: string;
  dynamo?: DynamoLike;
  document?: DynamoLike;
  now?: Date;
  pk?: string;
}

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

function usdText(value: unknown): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "0.000000";
  return amount.toFixed(6);
}

export function formatWeeklyUsage(item: WeeklyUsageItem | null | undefined): string {
  if (!item) return "Claude利用量: 当週の記録はありません";
  const lines = [
    `Claude利用量 ${item.pk}`,
    `calls ${item.callCount ?? 0} / in ${item.inputTokens ?? 0} / out ${item.outputTokens ?? 0}`,
    `推定 $${usdText(item.estimatedUsd)}`,
  ];
  const byFunction = item.byFunction ?? {};
  for (const name of ["index", "weekly", "kindle"]) {
    const row = byFunction[name];
    if (!row) continue;
    lines.push(`${name}: calls ${row.callCount ?? 0} / $${usdText(row.estimatedUsd)}`);
  }
  return lines.join("\n");
}

export { normalizeUsage };
