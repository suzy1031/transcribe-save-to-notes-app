import { EXTERNAL_API_FETCH_TIMEOUT_MS } from "./const.ts";

export function withFetchTimeout(
  init: RequestInit = {},
  timeoutMs: number = EXTERNAL_API_FETCH_TIMEOUT_MS,
): RequestInit {
  if (init.signal !== undefined) return init;
  return { ...init, signal: AbortSignal.timeout(timeoutMs) };
}
