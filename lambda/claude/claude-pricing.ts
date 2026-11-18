import { MODEL_PRICING } from "./const.ts";
import { asCount, microFromTokens, ratesFor } from "./helper.ts";
import type { NormalizedUsage, RawClaudeUsage } from "./types.ts";

/**
 * Claude API の生の usage オブジェクトを正規化する。
 * キャッシュ作成トークンの 5 分 / 1 時間内訳がある場合はその合計を優先し、無い場合は `cache_creation_input_tokens` を 5 分分として扱う。
 * @param usage Claude API レスポンスの usage オブジェクト
 * @returns 正規化されたトークン使用量
 */
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

/**
 * モデル ID と使用量から推定コストをマイクロドル（10^-6 USD）単位で計算する。
 * 未知のモデル ID の場合は `priced: false`・`micros: 0` を返す。
 * @param modelId Claude モデル ID
 * @param usage Claude API レスポンスの usage オブジェクト
 * @returns マイクロドル単位の推定コスト、価格設定の有無、正規化済みトークン数
 */
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

/**
 * マイクロドル（10^-6 USD）単位の整数を小数点以下 6 桁の USD 文字列に変換する。
 * @param micros マイクロドル単位の金額
 * @returns 小数点以下 6 桁の USD 文字列表記（例: `"0.001234"`）
 */
export function microToUsdDecimal(micros: number): string {
  const rounded = Math.round(micros);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded);
  const whole = Math.floor(abs / 1_000_000);
  const fraction = String(abs % 1_000_000).padStart(6, "0");
  return `${sign}${whole}.${fraction}`;
}
