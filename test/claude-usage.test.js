import assert from "node:assert/strict";
import test from "node:test";
import { estimateUsdMicros, microToUsdDecimal, normalizeUsage } from "../lambda/claude-pricing.ts";
import { formatWeeklyUsage, getWeeklyUsage, isoWeekKey, recordWeeklyUsage } from "../lambda/claude-usage.ts";
import { createClaudeKindleSummarizer } from "../lambda/kindle-summarize.ts";
import { createClaudeSummarizer } from "../lambda/summarize.ts";
import { createTranscriber } from "../lambda/transcribe/claude.ts";
import { reportWeeklyUsage } from "../lambda/weekly.ts";

test("isoWeekKey は東京の暦日で ISO 週を決める", () => {
  assert.equal(isoWeekKey(new Date("2026-11-07T00:00:00Z")), "WEEK#2026-W45");
  assert.equal(isoWeekKey(new Date("2026-11-01T00:00:00Z")), "WEEK#2026-W44");
  assert.equal(isoWeekKey(new Date("2026-01-01T00:00:00Z")), "WEEK#2026-W01");
  assert.equal(isoWeekKey(new Date("2025-12-31T15:00:00Z")), "WEEK#2026-W01");
});

test("normalizeUsage はキャッシュ内訳を合計し、内訳がなければ creation 合計を 5 分枠にする", () => {
  assert.deepEqual(
    normalizeUsage({
      input_tokens: 10,
      output_tokens: 4,
      cache_read_input_tokens: 2,
      cache_creation: { ephemeral_5m_input_tokens: 3, ephemeral_1h_input_tokens: 5 },
    }),
    {
      inputTokens: 10,
      outputTokens: 4,
      cacheReadInputTokens: 2,
      cacheCreationInputTokens: 8,
      cacheCreation5mTokens: 3,
      cacheCreation1hTokens: 5,
    },
  );
  const flat = normalizeUsage({ cache_creation_input_tokens: 7 });
  assert.equal(flat.cacheCreationInputTokens, 7);
  assert.equal(flat.cacheCreation5mTokens, 7);
  assert.equal(flat.cacheCreation1hTokens, 0);
});

test("estimateUsdMicros は公開単価でマイクロ USD を返す", () => {
  const sonnet = estimateUsdMicros("claude-sonnet-5-5", {
    input_tokens: 1_000_000,
    output_tokens: 1_000,
    cache_read_input_tokens: 1_000_000,
    cache_creation_input_tokens: 1_000,
  });
  assert.equal(sonnet.priced, true);
  assert.equal(sonnet.micros, 2_000_000 + 10_000 + 100_000 + 2_500);
  assert.equal(microToUsdDecimal(sonnet.micros), "2.112500");

  const haiku = estimateUsdMicros("claude-haiku-5-5", { input_tokens: 100_000, output_tokens: 2 });
  assert.equal(haiku.micros, 10_000 + 1);

  const longHaiku = estimateUsdMicros("claude-haiku-5-5", { input_tokens: 100_001, output_tokens: 1 });
  assert.equal(longHaiku.micros, Math.round((100_001 * 500_000) / 1_000_000) + 3);

  const unknown = estimateUsdMicros("claude-unknown", { input_tokens: 10, output_tokens: 10 });
  assert.equal(unknown.priced, false);
  assert.equal(unknown.micros, 0);
});

test("recordWeeklyUsage は当週 PK にトークンと推定 USD を ADD する", async () => {
  const commands = [];
  const dynamo = {
    send: async (command) => {
      commands.push(command);
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
  assert.equal(recorded.pk, "WEEK#2026-W45");
  assert.equal(recorded.estimatedUsd, "0.002500");
  assert.equal(commands.length, 3);
  assert.equal(commands[0].input.Key.pk.S, "WEEK#2026-W45");
  assert.match(commands[0].input.UpdateExpression, /if_not_exists\(#byFunction/);
  assert.equal(commands[1].input.ExpressionAttributeNames["#fn"], "index");
  const add = commands[2].input;
  assert.match(add.UpdateExpression, /^ADD callCount/);
  assert.equal(add.ExpressionAttributeValues[":input"].N, "1000");
  assert.equal(add.ExpressionAttributeValues[":output"].N, "50");
  assert.equal(add.ExpressionAttributeValues[":usd"].N, "0.002500");
  assert.equal(add.ExpressionAttributeNames["#fn"], "index");
});

test("recordWeeklyUsage はテーブル名が無いとき書き込まない", async () => {
  const previous = process.env.CLAUDE_USAGE_TABLE_NAME;
  delete process.env.CLAUDE_USAGE_TABLE_NAME;
  try {
    const recorded = await recordWeeklyUsage({
      functionName: "weekly",
      modelId: "claude-haiku-5-5",
      usage: { input_tokens: 1 },
      dynamo: { send: async () => assert.fail("send") },
    });
    assert.equal(recorded, null);
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_USAGE_TABLE_NAME;
    else process.env.CLAUDE_USAGE_TABLE_NAME = previous;
  }
});

test("getWeeklyUsage は当週の行を読む", async () => {
  let command;
  const item = await getWeeklyUsage({
    tableName: "notes-pipeline-claude-usage",
    document: {
      send: async (input) => {
        command = input;
        return { Item: { pk: "WEEK#2026-W45", callCount: 2, estimatedUsd: 0.0025 } };
      },
    },
    now: new Date("2026-11-07T03:00:00Z"),
  });
  assert.equal(command.input.Key.pk, "WEEK#2026-W45");
  assert.equal(command.input.ConsistentRead, true);
  assert.equal(item.callCount, 2);
});

test("formatWeeklyUsage は週合計と関数別の推定額を返す", () => {
  const text = formatWeeklyUsage({
    pk: "WEEK#2026-W45",
    callCount: 3,
    inputTokens: 100,
    outputTokens: 20,
    estimatedUsd: 0.0025,
    byFunction: {
      index: { callCount: 2, estimatedUsd: 0.002 },
      kindle: { callCount: 1, estimatedUsd: 0.0005 },
    },
  });
  assert.match(text, /WEEK#2026-W45/);
  assert.match(text, /calls 3/);
  assert.match(text, /推定 \$0\.002500/);
  assert.match(text, /index: calls 2/);
  assert.match(text, /kindle: calls 1/);
  assert.equal(formatWeeklyUsage(null), "Claude利用量: 当週の記録はありません");
});

test("reportWeeklyUsage は記録があるときだけ LINE する", async () => {
  const pushed = [];
  const logs = [];
  const reported = await reportWeeklyUsage({
    getUsage: async () => ({
      pk: "WEEK#2026-W45",
      callCount: 1,
      inputTokens: 1,
      outputTokens: 1,
      estimatedUsd: 0.000012,
    }),
    pushLine: async (text) => pushed.push(text),
    log: (text) => logs.push(text),
  });
  assert.equal(logs.length, 1);
  assert.equal(pushed.length, 1);
  assert.match(reported.text, /WEEK#2026-W45/);

  const empty = await reportWeeklyUsage({
    getUsage: async () => null,
    pushLine: async () => pushed.push("unused"),
    log: (text) => logs.push(text),
  });
  assert.match(empty.text, /記録はありません/);
  assert.equal(pushed.length, 1);
});

function claudeResponse(usage, { ok = true, model = "claude-sonnet-5-5" } = {}) {
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
  const calls = [];
  const transcribe = createTranscriber({
    apiKey: "key",
    fetchImpl: claudeResponse({ input_tokens: 3, output_tokens: 4 }),
    recordUsage: async (input) => calls.push(input),
  });
  await transcribe({ bytes: Buffer.from("png"), mimeType: "image/png" });
  assert.deepEqual(calls, [
    { functionName: "index", modelId: "claude-sonnet-5-5", usage: { input_tokens: 3, output_tokens: 4 } },
  ]);

  const failing = createTranscriber({
    apiKey: "key",
    fetchImpl: claudeResponse({}, { ok: false }),
    recordUsage: async () => calls.push("fail"),
  });
  await assert.rejects(
    () => failing({ bytes: Buffer.from("png"), mimeType: "image/png" }),
    /Claude transcription failed/,
  );
  assert.equal(calls.length, 1);
});

test("週次要約と Kindle 要約は成功時だけ利用量を記録する", async () => {
  const calls = [];
  const summarize = createClaudeSummarizer({
    apiKey: "key",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          model: "claude-haiku-5-5",
          usage: { input_tokens: 8 },
          content: [{ type: "text", text: "まとめ" }],
        }),
        {
          status: 200,
        },
      ),
    recordUsage: async (input) => calls.push(input),
  });
  assert.equal(await summarize("ノート"), "まとめ");

  const kindle = createClaudeKindleSummarizer({
    apiKey: "key",
    fetchImpl: claudeResponse({ input_tokens: 9 }, { model: "claude-sonnet-5-5" }),
    recordUsage: async (input) => calls.push(input),
  });
  assert.equal(await kindle({ bytes: Buffer.from("png"), mimeType: "image/jpeg" }), '{"title":"題","markdown":"本文"}');
  assert.deepEqual(
    calls.map((call) => call.functionName),
    ["weekly", "kindle"],
  );
});
