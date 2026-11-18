import type { ModelPricing } from "./types.ts";

// List prices in USD per million tokens.
// https://platform.claude.com/docs/en/about-claude/pricing
export const HAIKU_LONG_CONTEXT_TOKENS = 100_000;

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

export const FUNCTION_NAME = /^[A-Za-z][A-Za-z0-9_-]*$/;

export const DEFAULT_FX_RATE_URLS = [
  "https://api.frankfurter.dev/v1/latest?base=USD&symbols=JPY",
  "https://open.er-api.com/v6/latest/USD",
] as const;

export const DEFAULT_TIMEOUT_MS = 5_000;
