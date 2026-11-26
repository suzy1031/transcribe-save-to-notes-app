import { expect, test } from "vitest";
import { bunLambdaHandler } from "./bun-handler.ts";

test("bunLambdaHandler はイベントJSONとx-amzn-deadline-msからcontextを渡す", async () => {
  const deadline = Date.now() + 12_345;
  let capturedEvent: unknown;
  let remaining = 0;
  const adapter = bunLambdaHandler(async (event, context) => {
    capturedEvent = event;
    remaining = context.getRemainingTimeInMillis();
    return { ok: true };
  });

  const response = await adapter.fetch(
    new Request("https://lambda.local/2018-06-01/runtime/invocation/next", {
      method: "POST",
      headers: { "x-amzn-deadline-ms": String(deadline) },
      body: JSON.stringify({ source: "aws.scheduler" }),
    }),
  );

  expect(capturedEvent).toEqual({ source: "aws.scheduler" });
  expect(remaining).toBeGreaterThan(10_000);
  expect(remaining).toBeLessThanOrEqual(12_345);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});

test("bunLambdaHandler は空ボディを空オブジェクトとして扱い、期限ヘッダーが無い場合はInfinityを返す", async () => {
  let capturedEvent: unknown;
  let remaining = 0;
  const adapter = bunLambdaHandler(async (event, context) => {
    capturedEvent = event;
    remaining = context.getRemainingTimeInMillis();
    return { count: 0 };
  });

  const response = await adapter.fetch(
    new Request("https://lambda.local/2018-06-01/runtime/invocation/next", {
      method: "POST",
    }),
  );

  expect(capturedEvent).toEqual({});
  expect(remaining).toBe(Number.POSITIVE_INFINITY);
  expect(await response.json()).toEqual({ count: 0 });
});

test("bunLambdaHandler はハンドラの例外をそのまま投げる", async () => {
  const adapter = bunLambdaHandler(async () => {
    throw new Error("boom");
  });

  await expect(adapter.fetch(new Request("https://lambda.local/", { method: "POST", body: "{}" }))).rejects.toThrow(
    "boom",
  );
});
