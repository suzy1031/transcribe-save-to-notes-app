export const API_ERROR_DETAIL_MAX = 200;

const SECRET_REPLACEMENTS: ReadonlyArray< readonly [RegExp, string]> = [
  [/Bearer\s+\S+/gi, "Bearer [REDACTED]"],
  [/\b(sk-ant-|sk-)[a-zA-Z0-9_-]{8,}\b/g, "[REDACTED]"],
  [/"private_key"\s*:\s*"[^"]*"/g, '"private_key":"[REDACTED]"'],
  [/(api[_-]?key|token|secret|password)(\s*[=:]\s*)\S+/gi, "$1$2[REDACTED]"],
];

export function redactSecrets(text: unknown): string {
  let value = String(text);
  for (const [pattern, replacement] of SECRET_REPLACEMENTS) {
    value = value.replace(pattern, replacement);
  }
  return value;
}

export function parseApiErrorDetail(text: unknown): string {
  if (typeof text !== "string" || text.trim() === "") return "";
  try {
    const payload = JSON.parse(text) as {
      error?: { message?: unknown } | string;
      message?: unknown;
      error_description?: unknown;
    };
    const errorObj = typeof payload?.error === "object" && payload.error !== null ? payload.error : undefined;
    const candidate =
      errorObj?.message ??
      (typeof payload?.error === "string" ? payload.error : undefined) ??
      payload?.message ??
      payload?.error_description;
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return redactSecrets(candidate.trim());
    }
  } catch {
    // Keep the raw body for redaction when it is not JSON.
  }
  return redactSecrets(text.trim());
}

export function formatHttpErrorDetail(
  status: number | string,
  bodyText: string = "",
  statusText: string = "",
): string {
  const detail = parseApiErrorDetail(bodyText).slice(0, API_ERROR_DETAIL_MAX);
  if (detail) return `${status} ${detail}`;
  const safeStatusText = redactSecrets(String(statusText)).trim().slice(0, API_ERROR_DETAIL_MAX);
  if (safeStatusText) return `${status} ${safeStatusText}`;
  return String(status);
}

export function sanitizeErrorMessage(message: unknown): string {
  if (message == null) return "";
  return redactSecrets(String(message)).slice(0, API_ERROR_DETAIL_MAX);
}
