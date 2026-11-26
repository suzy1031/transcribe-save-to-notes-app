import { expect, test } from "vitest";
import { fetchUsdJpyRate } from "./fx-rate.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("fetchUsdJpyRate はプライマリ API から USD/JPY レートを取得する", async () => {
  const calledUrls: string[] = [];
  let receivedSignal: AbortSignal | null | undefined;
  const rate = await fetchUsdJpyRate({
    fetchFn: (async (input, init) => {
      calledUrls.push(String(input));
      receivedSignal = init?.signal;
      return jsonResponse({ base: "USD", rates: { JPY: 154.52 } });
    }) as typeof fetch,
  });

  expect(rate).toBe(154.52);
  expect(calledUrls).toHaveLength(1);
  expect(calledUrls[0]).toMatch(/frankfurter/);
  expect(receivedSignal).toBeInstanceOf(AbortSignal);
});

test("fetchUsdJpyRate はプライマリ失敗時にセカンダリ API へフォールバックする", async () => {
  const calledUrls: string[] = [];
  const rate = await fetchUsdJpyRate({
    fetchFn: (async (input) => {
      const url = String(input);
      calledUrls.push(url);
      if (calledUrls.length === 1) {
        return jsonResponse({ error: "unavailable" }, 503);
      }
      return jsonResponse({ result: "success", rates: { JPY: 155.1 } });
    }) as typeof fetch,
  });

  expect(rate).toBe(155.1);
  expect(calledUrls).toHaveLength(2);
  expect(calledUrls[1]).toMatch(/open\.er-api\.com/);
});

test("fetchUsdJpyRate は不正なレート値をスキップして次を試す", async () => {
  let attempt = 0;
  const rate = await fetchUsdJpyRate({
    fetchFn: (async () => {
      attempt += 1;
      if (attempt === 1) return jsonResponse({ rates: { JPY: -1 } });
      return jsonResponse({ rates: { JPY: 153.8 } });
    }) as typeof fetch,
  });

  expect(rate).toBe(153.8);
  expect(attempt).toBe(2);
});

test("fetchUsdJpyRate は全 API が失敗したとき null を返す", async () => {
  const rate = await fetchUsdJpyRate({
    fetchFn: (async () => {
      throw new Error("network down");
    }) as typeof fetch,
  });

  expect(rate).toBeNull();
});
