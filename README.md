# transcribe-save-to-notes-app

Google Drive の手書き画像を文字起こしし、Craft に保存して処理済みへ移す。毎週日曜には、その週の Craft ノートを要約して LINE へ送り、同じ要約を Craft に残して元ノートを処理済みへ移す。

- 実行: EventBridge Scheduler、毎日 8:00–11:50 JST、10分間隔
- 週次要約: 毎週日曜 9:00 JST。対象が無い週は LINE に「今週対象のノートはありませんでした」と送り、Craft には保存しない
- 実行環境: Lambda Node.js 26、`ap-northeast-1`
- 文字起こしと週次要約: `TRANSCRIPTION_PROVIDER` が `claude`（Claude Haiku 5.5）または `bedrock`（Nova Lite）
- 認証情報: Secrets Manager

## 構成

```
infra/app.js            CDK（Lambda、Scheduler、Secrets Manager）
lambda/index.js         朝のパイプライン
lambda/weekly.js        週次要約
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
