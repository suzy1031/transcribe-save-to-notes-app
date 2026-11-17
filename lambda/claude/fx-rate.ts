import { sanitizeErrorMessage } from "../shared/sanitize-error.ts";

export const DEFAULT_FX_RATE_URLS = [
  "https://api.frankfurter.dev/v1/latest?base=USD&symbols=JPY",
  "https://open.er-api.com/v6/latest/USD",
] as const;

const DEFAULT_TIMEOUT_MS = 5_000;

export interface FetchUsdJpyRateOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  urls?: ReadonlyArray<string>;
}

function parseJpyRate(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const rates = (payload as { rates?: unknown }).rates;
  if (!rates || typeof rates !== "object") return null;
  const jpy = (rates as { JPY?: unknown }).JPY;
  if (typeof jpy !== "number" || !Number.isFinite(jpy) || jpy <= 0) return null;
  return jpy;
}

export async function fetchUsdJpyRate({
  fetchFn = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  urls = DEFAULT_FX_RATE_URLS,
}: FetchUsdJpyRateOptions = {}): Promise<number | null> {
  for (const url of urls) {
    try {
      const response = await fetchFn(url, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        console.warn(`為替レート取得失敗 (${response.status}): ${url}`);
        continue;
      }
      const data: unknown = await response.json();
      const rate = parseJpyRate(data);
      if (rate !== null) return rate;
      console.warn(`為替レート形式不正: ${url}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`為替レート取得エラー (${url}): ${sanitizeErrorMessage(message)}`);
    }
  }
  return null;
}
