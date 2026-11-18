import { type AttributeValue, DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { microToUsdDecimal } from "./claude-pricing.ts";
import type { DynamoLike, ModelPricing, NormalizedUsage, RateTable } from "./types.ts";

/**
 * 任意の値を非負の整数トークン数に正規化する。
 * 有限でない値や負数は 0 として扱い、小数は切り捨てる。
 * @param value トークン数の元となる値
 * @returns 非負の整数トークン数
 */
export function asCount(value: unknown): number {
  const count = Number(value ?? 0);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.floor(count);
}

/**
 * プロンプトの合計トークン数に応じて適用する料金レートテーブルを返す。
 * `longContext` が定義されており、かつ合計トークン数がしきい値を超える場合はロングコンテキスト用レートを返す。
 * @param pricing モデルごとの料金設定
 * @param tokens 正規化済みのトークン使用量
 * @returns 適用するレートテーブル
 */
export function ratesFor(pricing: ModelPricing, tokens: NormalizedUsage): RateTable {
  const promptTokens = tokens.inputTokens + tokens.cacheReadInputTokens + tokens.cacheCreationInputTokens;
  if (pricing.longContext && promptTokens > pricing.longContext.thresholdTokens) return pricing.longContext;
  return pricing;
}

/**
 * トークン数と 100 万トークンあたりの USD 単価から、コストをマイクロドル（10^-6 USD）単位で計算する。
 * @param tokens トークン数
 * @param dollarsPerMTok 100 万トークンあたりの単価（USD）
 * @returns 四捨五入されたコスト（マイクロドル）
 */
export function microFromTokens(tokens: number, dollarsPerMTok: number): number {
  const priceMicroPerMTok = Math.round(dollarsPerMTok * 1_000_000);
  return Math.round((tokens * priceMicroPerMTok) / 1_000_000);
}

/**
 * 数値を DynamoDB の数値属性 (`N`) に変換する。
 * @param value 数値
 * @returns DynamoDB の `AttributeValue`
 */
export function numberAttribute(value: number): AttributeValue {
  return { N: String(value) };
}

/**
 * 関数別利用量スライスの初期値（すべて 0）を表す DynamoDB マップ属性を返す。
 * @returns ゼロ初期化されたスライスの `AttributeValue`
 */
export function zeroSlice(): AttributeValue {
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

/**
 * 指定されたパーティションキーのアイテムに `byFunction` マップが存在しない場合、空マップで初期化する。
 * @param dynamo DynamoDB クライアント
 * @param tableName テーブル名
 * @param pk パーティションキー
 */
export async function ensureByFunction(dynamo: DynamoLike, tableName: string, pk: string): Promise<void> {
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

/**
 * `byFunction` マップ内に指定された関数名のスライスが存在しない場合、ゼロ値で初期化する。
 * @param dynamo DynamoDB クライアント
 * @param tableName テーブル名
 * @param pk パーティションキー
 * @param functionName 関数名
 */
export async function ensureFunctionSlice(
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

/**
 * 全体および関数別の利用量・推定コストを加算するための `UpdateItemCommand` を生成する。
 * @param params コマンド生成に必要なテーブル名、キー、関数名、トークン数、コスト（マイクロドル）
 * @returns `UpdateItemCommand` インスタンス
 */
export function addUsageCommand({
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

/**
 * DynamoDB クライアントを返す。未指定の場合は新規 `DynamoDBClient` を生成する。
 * @param dynamo 任意の DynamoDB クライアント
 * @returns `DynamoLike` クライアント
 */
export function dynamoClient(dynamo?: DynamoLike): DynamoLike {
  return dynamo ?? new DynamoDBClient({});
}

/**
 * DynamoDB Document クライアントを返す。未指定の場合は `dynamoClient` から生成する。
 * @param document 任意の Document クライアント
 * @param dynamo 任意の低レベル DynamoDB クライアント
 * @returns `DynamoLike` クライアント
 */
export function documentClient(document?: DynamoLike, dynamo?: DynamoLike): DynamoLike {
  if (document) return document;
  return DynamoDBDocumentClient.from(dynamoClient(dynamo) as DynamoDBClient);
}

/**
 * 任意の値を有限な数値金額に変換する。有限でない場合は 0 を返す。
 * @param value 金額を表す値
 * @returns 数値金額
 */
export function toAmount(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

/**
 * USD 金額を小数点以下 3 桁の文字列にフォーマットする。
 * @param value USD 金額を表す値
 * @returns 小数点以下 3 桁の文字列
 */
export function usdText(value: unknown): string {
  return toAmount(value).toFixed(3);
}

/**
 * USD 金額と為替レートから円換算テキスト（例: `約150.0円`）を生成する。
 * @param usdValue USD 金額を表す値
 * @param rate USD/JPY レート
 * @returns フォーマットされた円換算文字列
 */
export function jpyText(usdValue: unknown, rate: number): string {
  return `約${(toAmount(usdValue) * rate).toFixed(1)}円`;
}

/**
 * カウント値を 3 桁区切りの整数文字列にフォーマットする。
 * @param value カウント値
 * @returns カンマ区切りの整数文字列
 */
export function formatCount(value: unknown): string {
  return asCount(value).toLocaleString("en-US");
}

/**
 * 為替レートが有効な正の有限数である場合にその値を返し、無効な場合は `null` を返す。
 * @param rate 為替レート
 * @returns 有効なレート、または `null`
 */
export function validRate(rate?: number | null): number | null {
  return typeof rate === "number" && Number.isFinite(rate) && rate > 0 ? rate : null;
}

/**
 * 為替 API のレスポンス JSON から `rates.JPY` の正の有限数値を抽出する。
 * 構造が不正、または有効なレートでない場合は `null` を返す。
 * @param payload レスポンス JSON ペイロード
 * @returns USD/JPY レート、または `null`
 */
export function parseJpyRate(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const rates = (payload as { rates?: unknown }).rates;
  if (!rates || typeof rates !== "object") return null;
  const jpy = (rates as { JPY?: unknown }).JPY;
  return typeof jpy === "number" ? validRate(jpy) : null;
}
