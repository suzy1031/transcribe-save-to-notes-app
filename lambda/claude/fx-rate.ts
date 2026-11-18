import { sanitizeErrorMessage } from "../shared/sanitize-error.ts";
import { DEFAULT_FX_RATE_URLS, DEFAULT_TIMEOUT_MS } from "./const.ts";
import { parseJpyRate } from "./helper.ts";
import type { FetchUsdJpyRateOptions } from "./types.ts";

/**
 * 複数の為替レート API を順に試行して現在の USD/JPY レートを取得する。
 * すべての API が失敗または不正なレスポンスだった場合は `null` を返す。
 * @param options `fetch` 実装・タイムアウト・取得先 URL リストなどのオプション
 * @returns USD/JPY レート、または取得失敗時は `null`
 */
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
