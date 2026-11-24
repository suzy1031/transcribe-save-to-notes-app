import { expect, test } from "vitest";
import { createClaudeKindleSummarizer } from "../kindle/kindle-summarize.ts";
import { createClaudeSummarizer } from "../summarize/summarize.ts";
import { createTranscriber } from "../transcribe/claude.ts";
import { reportWeeklyUsage } from "../weekly/weekly.ts";
import { estimateUsdMicros, microToUsdDecimal, normalizeUsage } from "./claude-pricing.ts";
import { formatWeeklyUsage, getWeeklyUsage, isoWeekKey, recordWeeklyUsage } from "./claude-usage.ts";
import type { RawClaudeUsage, RecordWeeklyUsageOptions } from "./types.ts";

test("isoWeekKey は東京の暦日で ISO 週を決める", () => {
  expect(isoWeekKey(new Date("2026-11-07T00:00:00Z"))).toBe("WEEK#2026-W45");
  expect(isoWeekKey(new Date("2026-11-01T00:00:00Z"))).toBe("WEEK#2026-W44");
  expect(isoWeekKey(new Date("2026-01-01T00:00:00Z"))).toBe("WEEK#2026-W01");
  expect(isoWeekKey(new Date("2025-12-31T15:00:00Z"))).toBe("WEEK#2026-W01");
});

test("normalizeUsage はキャッシュ内訳を合計し、内訳がなければ creation 合計を 5 分枠にする", () => {
  expect(
    normalizeUsage({
      input_tokens: 10,
      output_tokens: 4,
      cache_read_input_tokens: 2,
      cache_creation: { ephemeral_5m_input_tokens: 3, ephemeral_1h_input_tokens: 5 },
    }),
  ).toEqual({
    inputTokens: 10,
    outputTokens: 4,
    cacheReadInputTokens: 2,
    cacheCreationInputTokens: 8,
    cacheCreation5mTokens: 3,
    cacheCreation1hTokens: 5,
  });
  const flat = normalizeUsage({ cache_creation_input_tokens: 7 });
  expect(flat.cacheCreationInputTokens).toBe(7);
  expect(flat.cacheCreation5mTokens).toBe(7);
  expect(flat.cacheCreation1hTokens).toBe(0);
});

test("estimateUsdMicros は公開単価でマイクロ USD を返す", () => {
  const sonnet = estimateUsdMicros("claude-sonnet-5-5", {
    input_tokens: 1_000_000,
    output_tokens: 1_000,
    cache_read_input_tokens: 1_000_000,
    cache_creation_input_tokens: 1_000,
  });
  expect(sonnet.priced).toBe(true);
  expect(sonnet.micros).toBe(2_000_000 + 10_000 + 100_000 + 2_500);
  expect(microToUsdDecimal(sonnet.micros)).toBe("2.112500");

  const haiku = estimateUsdMicros("claude-haiku-5-5", { input_tokens: 100_000, output_tokens: 2 });
  expect(haiku.micros).toBe(10_000 + 1);

  const longHaiku = estimateUsdMicros("claude-haiku-5-5", { input_tokens: 100_001, output_tokens: 1 });
  expect(longHaiku.micros).toBe(Math.round((100_001 * 500_000) / 1_000_000) + 3);

  const unknown = estimateUsdMicros("claude-unknown", { input_tokens: 10, output_tokens: 10 });
  expect(unknown.priced).toBe(false);
  expect(unknown.micros).toBe(0);
});

test("recordWeeklyUsage は当週 PK にトークンと推定 USD を ADD する", async () => {
  const commands: Array<{
    input: {
      Key: { pk: { S: string } };
      UpdateExpression: string;
      ExpressionAttributeNames: Record<string, string>;
      ExpressionAttributeValues: Record<string, { N: string }>;
    };
  }> = [];
  const dynamo = {
    send: async (command: unknown) => {
      commands.push(command as (typeof commands)[number]);
    },
  };
  const recorded = await recordWeeklyUsage({
    functionName: "index",
    modelId: "claude-sonnet-5-5",
    usage: { input_tokens: 1_000, output_tokens: 50 },
    tableName: "notes-pipeline-claude-usage",
    dynamo,
    now: new Date("2026-11-07T03:00:00Z"),
  });
  expect(recorded?.pk).toBe("WEEK#2026-W45");
  expect(recorded?.estimatedUsd).toBe("0.002500");
  expect(commands.length).toBe(3);
  expect(commands[0].input.Key.pk.S).toBe("WEEK#2026-W45");
  expect(commands[0].input.UpdateExpression).toMatch(/if_not_exists\(#byFunction/);
  expect(commands[1].input.ExpressionAttributeNames["#fn"]).toBe("index");
  const add = commands[2].input;
  expect(add.UpdateExpression).toMatch(/^ADD callCount/);
  expect(add.ExpressionAttributeValues[":input"].N).toBe("1000");
  expect(add.ExpressionAttributeValues[":output"].N).toBe("50");
  expect(add.ExpressionAttributeValues[":usd"].N).toBe("0.002500");
  expect(add.ExpressionAttributeNames["#fn"]).toBe("index");
});

test("recordWeeklyUsage はテーブル名が無いとき書き込まない", async () => {
  const previous = process.env.CLAUDE_USAGE_TABLE_NAME;
  delete process.env.CLAUDE_USAGE_TABLE_NAME;
  try {
    const recorded = await recordWeeklyUsage({
      functionName: "weekly",
      modelId: "claude-haiku-5-5",
      usage: { input_tokens: 1 },
      dynamo: { send: async () => expect.unreachable("send") },
    });
    expect(recorded).toBe(null);
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_USAGE_TABLE_NAME;
    else process.env.CLAUDE_USAGE_TABLE_NAME = previous;
  }
});

test("getWeeklyUsage は当週の行を読む", async () => {
  let command: { input: { Key: { pk: string }; ConsistentRead: boolean } } | undefined;
  const item = await getWeeklyUsage({
    tableName: "notes-pipeline-claude-usage",
    document: {
      send: async (input: unknown) => {
        command = input as typeof command;
        return { Item: { pk: "WEEK#2026-W45", callCount: 2, estimatedUsd: 0.0025 } };
      },
    },
    now: new Date("2026-11-07T03:00:00Z"),
  });
  expect(command?.input.Key.pk).toBe("WEEK#2026-W45");
  expect(command?.input.ConsistentRead).toBe(true);
  expect(item?.callCount).toBe(2);
});

test("formatWeeklyUsage は週合計と関数別の推定額を日本円・ドルで返す", () => {
  const sample = {
    pk: "WEEK#2026-W46",
    callCount: 16,
    inputTokens: 75892,
    outputTokens: 7329,
    estimatedUsd: 0.20075,
    byFunction: {
      index: { callCount: 5, estimatedUsd: 0.06377 },
      weekly: { callCount: 1, estimatedUsd: 0.00128 },
      kindle: { callCount: 10, estimatedUsd: 0.1357 },
    },
  };

  const withRate = formatWeeklyUsage(sample, 154.5);
  expect(withRate).toBe(
    [
      "Claude利用量 (2026-W46)",
      "合計: 約31.0円 ($0.201) ※1ドル=154.5円",
      "16回 / 入力 75,892 / 出力 7,329 tok",
      "- index: 約9.9円 ($0.064 / 5回)",
      "- weekly: 約0.2円 ($0.001 / 1回)",
      "- kindle: 約21.0円 ($0.136 / 10回)",
    ].join("\n"),
  );

  const withoutRate = formatWeeklyUsage(sample, null);
  expect(withoutRate).toBe(
    [
      "Claude利用量 (2026-W46)",
      "合計: $0.201 (円換算取得失敗)",
      "16回 / 入力 75,892 / 出力 7,329 tok",
      "- index: $0.064 (5回)",
      "- weekly: $0.001 (1回)",
      "- kindle: $0.136 (10回)",
    ].join("\n"),
  );

  expect(formatWeeklyUsage(null)).toBe("Claude利用量: 当週の記録はありません");
});

test("reportWeeklyUsage は記録があるときだけ為替取得して LINE する", async () => {
  const pushed: string[] = [];
  const logs: string[] = [];
  let rateCalls = 0;

  const reported = await reportWeeklyUsage({
    getUsage: async () => ({
      pk: "WEEK#2026-W45",
      callCount: 1,
      inputTokens: 1,
      outputTokens: 1,
      estimatedUsd: 0.01,
    }),
    getUsdJpyRate: async () => {
      rateCalls += 1;
      return 150;
    },
    pushLine: async (text) => {
      pushed.push(text);
    },
    log: (text) => logs.push(text),
  });
  expect(rateCalls).toBe(1);
  expect(logs.length).toBe(1);
  expect(pushed.length).toBe(1);
  expect(reported.text).toMatch(/2026-W45/);
  expect(reported.text).toMatch(/約1\.5円 \(\$0\.010\)/);

  const fallback = await reportWeeklyUsage({
    getUsage: async () => ({
      pk: "WEEK#2026-W45",
      callCount: 1,
      inputTokens: 1,
      outputTokens: 1,
      estimatedUsd: 0.01,
    }),
    getUsdJpyRate: async () => {
      throw new Error("fx down");
    },
    pushLine: async (text) => {
      pushed.push(text);
    },
    log: (text) => logs.push(text),
  });
  expect(pushed.length).toBe(2);
  expect(fallback.text).toMatch(/\$0\.010 \(円換算取得失敗\)/);

  const empty = await reportWeeklyUsage({
    getUsage: async () => null,
    getUsdJpyRate: async () => {
      rateCalls += 1;
      return 150;
    },
    pushLine: async () => {
      pushed.push("unused");
    },
    log: (text) => logs.push(text),
  });
  expect(rateCalls).toBe(1);
  expect(empty.text).toMatch(/記録はありません/);
  expect(pushed.length).toBe(2);
});

function claudeResponse(
  usage: RawClaudeUsage,
  { ok = true, model = "claude-sonnet-5-5" }: { ok?: boolean; model?: string } = {},
): typeof fetch {
  return async () =>
    new Response(
      JSON.stringify(
        ok
          ? { model, usage, content: [{ type: "text", text: '{"title":"題","markdown":"本文"}' }] }
          : { error: { message: "nope" } },
      ),
      { status: ok ? 200 : 500 },
    );
}

test("文字起こし成功時だけ index の利用量を記録する", async () => {
  const calls: Array<RecordWeeklyUsageOptions | string> = [];
  const transcribe = createTranscriber({
    apiKey: "key",
    fetchImpl: claudeResponse({ input_tokens: 3, output_tokens: 4 }),
    recordUsage: async (input) => calls.push(input),
  });
  await transcribe({ bytes: Buffer.from("png"), mimeType: "image/png" });
  expect(calls).toEqual([
    { functionName: "index", modelId: "claude-sonnet-5-5", usage: { input_tokens: 3, output_tokens: 4 } },
  ]);

  const failing = createTranscriber({
    apiKey: "key",
    fetchImpl: claudeResponse({}, { ok: false }),
    recordUsage: async () => calls.push("fail"),
  });
  await expect(failing({ bytes: Buffer.from("png"), mimeType: "image/png" })).rejects.toThrow(
    /Claude transcription failed/,
  );
  expect(calls.length).toBe(1);
});

test("週次要約と Kindle 要約は成功時だけ利用量を記録する", async () => {
  const calls: RecordWeeklyUsageOptions[] = [];
  const summarize = createClaudeSummarizer({
    apiKey: "key",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          model: "claude-haiku-5-5",
          usage: { input_tokens: 8 },
          content: [
            {
              type: "text",
              text: JSON.stringify({ lineSummary: "LINEまとめ", obsidianMarkdown: "保存まとめ" }),
            },
          ],
        }),
        {
          status: 200,
        },
      ),
    recordUsage: async (input) => calls.push(input),
  });
  expect(await summarize("ノート")).toEqual({ lineSummary: "LINEまとめ", obsidianMarkdown: "保存まとめ" });

  const kindle = createClaudeKindleSummarizer({
    apiKey: "key",
    fetchImpl: claudeResponse({ input_tokens: 9 }, { model: "claude-sonnet-5-5" }),
    recordUsage: async (input) => calls.push(input),
  });
  expect(await kindle({ bytes: Buffer.from("png"), mimeType: "image/jpeg" })).toBe('{"title":"題","markdown":"本文"}');
  expect(calls.map((call) => call.functionName)).toEqual(["weekly", "kindle"]);
});
