import { EXTERNAL_API_FETCH_TIMEOUT_MS } from "./const.js";

export function withFetchTimeout(init = {}) {
  if (init.signal !== undefined) return init;
  return { ...init, signal: AbortSignal.timeout(EXTERNAL_API_FETCH_TIMEOUT_MS) };
}
