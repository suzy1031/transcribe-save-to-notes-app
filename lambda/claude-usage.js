import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { TOKYO_TIME_ZONE } from "./const.js";
import { estimateUsdMicros, microToUsdDecimal, normalizeUsage } from "./claude-pricing.js";

const FUNCTION_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

function tokyoDate(now, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function isoWeekKey(now = new Date(), timeZone = TOKYO_TIME_ZONE) {
  const [year, month, day] = tokyoDate(now, timeZone).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((date - yearStart) / 86_400_000 + 1) / 7);
  return `WEEK#${isoYear}-W${String(week).padStart(2, "0")}`;
}

function numberAttribute(value) {
  return { N: String(value) };
}

function zeroSlice() {
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

async function ensureByFunction(dynamo, tableName, pk) {
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

async function ensureFunctionSlice(dynamo, tableName, pk, functionName) {
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

function addUsageCommand({ tableName, pk, functionName, tokens, micros }) {
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

function dynamoClient(dynamo) {
  return dynamo ?? new DynamoDBClient({});
}

function documentClient(document, dynamo) {
  if (document) return document;
  return DynamoDBDocumentClient.from(dynamoClient(dynamo));
}

export async function recordWeeklyUsage({
  functionName,
  modelId,
  usage,
  tableName = process.env.CLAUDE_USAGE_TABLE_NAME ?? "",
  dynamo,
  now = new Date(),
} = {}) {
  if (!tableName) return null;
  if (!FUNCTION_NAME.test(functionName ?? "")) throw new Error(`Invalid functionName: ${functionName}`);
  const { micros, priced, tokens } = estimateUsdMicros(modelId, usage);
  if (!priced) console.warn(`Claude pricing is unknown for model ${modelId}`);
  const pk = isoWeekKey(now);
  const client = dynamoClient(dynamo);
  await ensureByFunction(client, tableName, pk);
  await ensureFunctionSlice(client, tableName, pk, functionName);
  await client.send(addUsageCommand({ tableName, pk, functionName, tokens, micros }));
  return { pk, ...tokens, estimatedUsd: microToUsdDecimal(micros) };
}

export async function getWeeklyUsage({
  tableName = process.env.CLAUDE_USAGE_TABLE_NAME ?? "",
  dynamo,
  document,
  now = new Date(),
  pk = isoWeekKey(now),
} = {}) {
  if (!tableName) return null;
  const result = await documentClient(document, dynamo).send(
    new GetCommand({
      TableName: tableName,
      Key: { pk },
      ConsistentRead: true,
    }),
  );
  return result.Item ?? null;
}

function usdText(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "0.000000";
  return amount.toFixed(6);
}

export function formatWeeklyUsage(item) {
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
