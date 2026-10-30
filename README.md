# transcribe-save-to-notes-app

Google Drive の手書き画像を文字起こしし、Craft に保存して処理済みへ移す。

- 実行: EventBridge Scheduler、毎日 8:00–11:50 JST、10分間隔
- 実行環境: Lambda Node.js 26、`ap-northeast-1`
- 文字起こし: `TRANSCRIPTION_PROVIDER` が `claude`（Claude Haiku 5.5）または `bedrock`（Nova Lite）
- 認証情報: Secrets Manager

## 構成

```
infra/app.js            CDK（Lambda、Scheduler、Secrets Manager）
lambda/index.js         パイプライン
lambda/drive.js         Google Drive
lambda/craft.js         Craft
lambda/prompt.js        文字起こしプロンプト
lambda/transcribe/      claude / bedrock
test/                   node:test
.env.example            ローカル実行用の環境変数
```

## コマンド

```sh
npm install
npm test
npx cdk synth
npx cdk deploy
```
