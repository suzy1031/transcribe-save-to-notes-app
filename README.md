# transcribe-save-to-notes-app

Google Drive の手書き画像を文字起こしし、Craft に保存して処理済みへ移す。毎週日曜には、その週の Craft ノートを要約して LINE へ送り、同じ要約を Craft に残して元ノートを処理済みへ移す。

- 実行: EventBridge Scheduler、毎日 8:00–11:50 JST、10分間隔。保存と失敗は LINE へ通知し、画像が無いときは通知しない
- 週次要約: 毎週日曜 9:00 JST。対象が無い週は LINE に「今週対象のノートはありませんでした」と送り、Craft には保存しない
- 週次リマインド: 毎週日曜 9:00 JST。`daily_note_summaries` 内で実行日の7日前を対象に、まず作成日で1件を検索し、0件ならタイトル `週次まとめ YYYY-MM-DD`（ゼロ埋め／非ゼロ埋め）で再検索。1件なら LINE（タイトル + Craft アプリリンク）。該当無しは「リマインドはありませんでした。」。失敗時は「週次リマインドに失敗しました」
- Kindle 要約: 毎週月曜 6:00 JST。Drive の `kindle` 配下の `kindle_*` フォルダ内画像を要約し、Craft に同名フォルダがあれば「要約」ノートへ追記（0件なら新規、2件以上はスキップ）。成功した画像は各 `kindle_*` 内の `processed` へ移動。1回の実行で処理または失敗が1枚以上あれば LINE に件数と Craft アプリリンクを1通送る
- 実行環境: Lambda Node.js 26、`ap-northeast-1`
- 文字起こし: `TRANSCRIPTION_PROVIDER` が `claude`（Claude Sonnet 5.5）または `bedrock`（Nova Lite）
- 週次要約: Claude Haiku 5.5
- 認証情報: Secrets Manager

## 構成

```
infra/app.js            CDK（Lambda、Scheduler、Secrets Manager）
lambda/const.ts           共有定数
lambda/const.js           const.ts の re-export（ESM 解決用）
lambda/index.js         朝のパイプライン
lambda/weekly.js        週次要約
lambda/reminder.js      週次リマインド
lambda/kindle.js        Kindle 画像要約
lambda/kindle-summarize.js  Kindle 画像要約（Vision）
lambda/kindle-prompt.js Kindle 要約プロンプト
lambda/drive.js         Google Drive
lambda/craft.js         Craft
lambda/line.js          LINE
lambda/prompt.js        文字起こしプロンプト
lambda/summary-prompt.js 週次要約プロンプト
lambda/summarize.js     週次要約（claude / bedrock）
lambda/transcribe/      claude / bedrock
test/                   node:test
.github/workflows/ci.yml  pull request で test、main で cdk deploy
.env.example            ローカル実行用の環境変数
```

## コマンド

```sh
npm install
npm test
npx cdk synth
npx cdk deploy
```
