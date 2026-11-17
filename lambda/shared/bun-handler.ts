import type { LambdaContextLike } from "./types.ts";

export interface BunFetchHandler {
  fetch(request: Request): Promise<Response>;
}

function parseDeadlineMs(headerValue: string | null): number {
  if (!headerValue) return Number.POSITIVE_INFINITY;
  const parsed = Number(headerValue);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

async function parseEvent(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.trim() === "") return {};
  return JSON.parse(text);
}

export function bunLambdaHandler<TResult>(
  handler: (event: unknown, context: LambdaContextLike) => Promise<TResult>,
): BunFetchHandler {
  return {
    async fetch(request: Request): Promise<Response> {
      const deadlineMs = parseDeadlineMs(request.headers.get("x-amzn-deadline-ms"));
      const context: LambdaContextLike = {
        getRemainingTimeInMillis: () =>
          Number.isFinite(deadlineMs) ? Math.max(0, deadlineMs - Date.now()) : Number.POSITIVE_INFINITY,
      };
      const event = await parseEvent(request);
      const result = await handler(event, context);
      return Response.json(result ?? {});
    },
  };
}
