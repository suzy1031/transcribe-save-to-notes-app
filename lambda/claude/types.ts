export interface RateTable {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWrite5mPerMTok: number;
  cacheWrite1hPerMTok: number;
}

export interface ModelPricing extends RateTable {
  longContext?: RateTable & { thresholdTokens: number };
}

export interface RawClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
}

export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
}

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
