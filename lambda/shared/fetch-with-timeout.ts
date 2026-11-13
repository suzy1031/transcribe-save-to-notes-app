import { EXTERNAL_API_FETCH_TIMEOUT_MS } from "./const.ts";

export function withFetchTimeout(init: RequestInit = {}): RequestInit {
  if (init.signal !== undefined) return init;
  return { ...init, signal: AbortSignal.timeout(EXTERNAL_API_FETCH_TIMEOUT_MS) };
}
