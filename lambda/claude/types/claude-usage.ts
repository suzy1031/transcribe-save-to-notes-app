import type { RawClaudeUsage } from "./claude-pricing.ts";

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
