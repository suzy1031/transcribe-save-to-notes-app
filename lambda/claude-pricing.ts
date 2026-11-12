// List prices in USD per million tokens.
// https://platform.claude.com/docs/en/about-claude/pricing
const HAIKU_LONG_CONTEXT_TOKENS = 100_000;

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

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-5-5": {
    inputPerMTok: 2,
    outputPerMTok: 10,
    cacheReadPerMTok: 0.1,
    cacheWrite5mPerMTok: 2.5,
    cacheWrite1hPerMTok: 4,
  },
  "claude-haiku-5-5": {
    inputPerMTok: 0.1,
    outputPerMTok: 0.5,
    cacheReadPerMTok: 0.01,
    cacheWrite5mPerMTok: 0.125,
    cacheWrite1hPerMTok: 0.2,
    longContext: {
      thresholdTokens: HAIKU_LONG_CONTEXT_TOKENS,
      inputPerMTok: 0.5,
      outputPerMTok: 2.5,
      cacheReadPerMTok: 0.05,
      cacheWrite5mPerMTok: 0.625,
      cacheWrite1hPerMTok: 1,
    },
  },
};

function asCount(value: unknown): number {
  const count = Number(value ?? 0);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.floor(count);
}

export function normalizeUsage(usage: RawClaudeUsage = {}): NormalizedUsage {
  const creation = usage.cache_creation ?? {};
  const cache5m = asCount(creation.ephemeral_5m_input_tokens);
  const cache1h = asCount(creation.ephemeral_1h_input_tokens);
  const cacheCreationInputTokens =
    cache5m + cache1h > 0 ? cache5m + cache1h : asCount(usage.cache_creation_input_tokens);
  return {
    inputTokens: asCount(usage.input_tokens),
    outputTokens: asCount(usage.output_tokens),
    cacheReadInputTokens: asCount(usage.cache_read_input_tokens),
    cacheCreationInputTokens,
    cacheCreation5mTokens: cache5m + cache1h > 0 ? cache5m : asCount(usage.cache_creation_input_tokens),
    cacheCreation1hTokens: cache1h,
  };
}

function ratesFor(pricing: ModelPricing, tokens: NormalizedUsage): RateTable {
  const promptTokens = tokens.inputTokens + tokens.cacheReadInputTokens + tokens.cacheCreationInputTokens;
  if (pricing.longContext && promptTokens > pricing.longContext.thresholdTokens) return pricing.longContext;
  return pricing;
}

function microFromTokens(tokens: number, dollarsPerMTok: number): number {
  const priceMicroPerMTok = Math.round(dollarsPerMTok * 1_000_000);
  return Math.round((tokens * priceMicroPerMTok) / 1_000_000);
}

export function estimateUsdMicros(
  modelId: string,
  usage?: RawClaudeUsage,
): { micros: number; priced: boolean; tokens: NormalizedUsage } {
  const pricing = MODEL_PRICING[modelId];
  const tokens = normalizeUsage(usage);
  if (!pricing) return { micros: 0, priced: false, tokens };
  const rates = ratesFor(pricing, tokens);
  const micros =
    microFromTokens(tokens.inputTokens, rates.inputPerMTok) +
    microFromTokens(tokens.outputTokens, rates.outputPerMTok) +
    microFromTokens(tokens.cacheReadInputTokens, rates.cacheReadPerMTok) +
    microFromTokens(tokens.cacheCreation5mTokens, rates.cacheWrite5mPerMTok) +
    microFromTokens(tokens.cacheCreation1hTokens, rates.cacheWrite1hPerMTok);
  return { micros, priced: true, tokens };
}

export function microToUsdDecimal(micros: number): string {
  const rounded = Math.round(micros);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const whole = Math.floor(abs / 1_000_000);
  const fraction = String(abs % 1_000_000).padStart(6, "0");
  return `${sign}${whole}.${fraction}`;
}
