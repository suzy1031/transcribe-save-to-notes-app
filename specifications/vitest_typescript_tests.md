# テストを Vitest の TypeScript にする

移行前は [package.json](../package.json) の `node --test` と、`test/` の 14 個の `.test.js`（`node:test` と `node:assert/strict`）。依存は関数の引数で渡していて、モジュールモックはない。

## ランナーと型検査

- `vitest`、`typescript`、`@types/node` を `bun add --exact -D` で入れる。`package.json` にキャレットは付けない。
- [package.json](../package.json) の `test` を `vitest run` にし、`typecheck` を `tsc --noEmit` として追加する。
- [tsconfig.json](../tsconfig.json) は `strict`、`noEmit`、`module` と `moduleResolution` を `NodeNext`、`allowImportingTsExtensions`、`skipLibCheck`。`include` は `lambda`（テストも `lambda/**/*.test.ts` に配置）。`infra/` は含めない。
- [.github/workflows/ci.yml](../.github/workflows/ci.yml) の test ジョブに `bun run typecheck` を `bun run test` の前に足す。
- Vitest の設定ファイルは置かない。デフォルトの環境と `*.test.ts` の検出で足りる。`expect`、`test`、`vi` は `vitest` から明示的に import する。

テストが `lambda/**/*.ts` を import するため、`tsc` は取り込んだ lambda も検査する。既存の明示的な `any` はそのまま残す。`noImplicitAny` で出た箇所だけ直す。例は [lambda/weekly/weekly.ts](../lambda/weekly/weekly.ts) の `const notes = []`。

## テストの書き換え

テストファイルを各ドメインディレクトリ配下の `lambda/**/*.test.ts` に配置し、次のように置き換える。

- `assert.equal` は `expect(...).toBe`
- `assert.deepEqual` は `expect(...).toEqual`
- `assert.throws(fn, /.../)` は `expect(fn).toThrow(/.../)`
- `assert.match` は `expect(...).toMatch`

`console.error` の手差し替えは [lambda/shared/job.test.ts](../lambda/shared/job.test.ts) の 2 件と [lambda/reminder/reminder.test.ts](../lambda/reminder/reminder.test.ts) の 1 件。`vi.spyOn(console, "error")` にして `mockRestore()` する。

引数のないヘルパー 4 つに、実装側の引数型を付ける。

- `pipeline(overrides)` は `Partial<Parameters<typeof processInbox>[0]>`（[lambda/inbox/index.ts](../lambda/inbox/index.ts)）
- `weekly(overrides)` は `processWeekly` の引数（[lambda/weekly/weekly.ts](../lambda/weekly/weekly.ts)）
- `reminder(overrides)` は `processReminder` の引数（[lambda/reminder/reminder.ts](../lambda/reminder/reminder.ts)）
- `claudeResponse(usage, options)` は呼び出し元の usage と `{ ok?: boolean; model?: string }`

`calls` の配列にも要素の型を付ける。`vi.mock` は使わない。

## 記述の更新

- [README.md](../README.md) のテストの説明を Vitest（各ディレクトリに `*.test.ts`）にする。
- [specifications/csv_spreadsheet_import.md](csv_spreadsheet_import.md) の `node:test` を Vitest に変える。

## 確認

`bun run typecheck` と `bun run test` が通ることを確認する。
