# transcribe-save-to-notes-app

## 構成

```
infra/app.js                 CDK（Lambda、Scheduler、Secrets Manager）
lambda/inbox/                朝のパイプライン
lambda/weekly/               週次要約
lambda/reminder/             週次リマインド
lambda/kindle/               Kindle 画像要約
lambda/csv/                  CSV のパースとスプレッドシート取り込み
lambda/sheets/               Google Sheets
lambda/drive/                Google Drive
lambda/craft/                Craft
lambda/line/                 LINE
lambda/claude/               Claude の料金と週次利用量
lambda/summarize/            週次要約（claude / bedrock）
lambda/transcribe/           文字起こし（claude / bedrock）
lambda/shared/               共有定数、タイムアウト、エラー整形
test/                        node:test
.github/workflows/ci.yml     pull request で test、main で cdk deploy
.env.example                 ローカル実行用の環境変数
```

## コマンド

```sh
npm install
npm run check
npm test
npx cdk synth
npx cdk deploy
```
