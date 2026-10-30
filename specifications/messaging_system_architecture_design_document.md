# 週次Craftノート要約＆LINE通知システム 仕様書

Craft APIから指定フォルダ内の過去1週間分のノートを取得し、AIで統合要約の上、LINE Messaging API経由で通知したのち、処理済みノートを別フォルダへ自動移動するバッチシステムの仕様書です。

---

## 1. システム概要

* **目的**: 1週間に作成されたCraft内のノート（指定フォルダ内）を自動回収・統合要約し、LINEへ通知。完了後にノートを処理済みフォルダへ移動して整理を自動化する。
* **実行頻度**: 毎週日曜日 JST 09:00（バッチ処理）
* **主要インフラ**: AWS (EventBridge, Lambda), LINE Messaging API

---

## 2. システム構成図

```
[AWS EventBridge]
   │ 毎週日曜日 JST 09:00 (Cron: cron(0 0 ? * SUN *))
   ▼
[AWS Lambda] (Node.js 26.x)
   │
   ├── 1. Craft API より `/daily_note_transcribe` 内の直近7日分ドキュメントを取得
   ├── 2. 取得した全ノートのMarkdown本文を統合
   ├── 3. AIモジュール（既存構成に準拠）で要約・抽出処理
   ├── 4. LINE Messaging API (Push Message) を使用して指定LINEへメッセージ送信
   └── 5. 処理成功後、Craft API で該当ドキュメントを `/processed` フォルダへ移動
   ▼
[LINE アプリ] (指定されたLINEアカウント / トーク画面)
```

---

## 3. 各コンポーネント詳細仕様

### 3.1. AWS EventBridge (スケジューラ)
* **ルール名**: `craft-weekly-summary-trigger`
* **スケジュール式**: `cron(0 0 ? * SUN *)`
  * ※UTC時間 `日曜日 00:00` ＝ JST `日曜日 09:00`

### 3.2. AWS Lambda (バックエンド)
* **関数名**: `craft-weekly-summarizer`
* **ランタイム**: Node.js 26.x
* **タイムアウト設定**: 3分（API応答およびAI推論時間を考慮）
* **環境変数**:
  * `CRAFT_API_KEY`: Craft Connect APIの認証キー
  * `SOURCE_FOLDER_PATH`: 対象フォルダパス（`daily_note_transcribe`）
  * `PROCESSED_FOLDER_PATH`: 移動先フォルダパス（`processed`）
  * `LINE_CHANNEL_ACCESS_TOKEN`: LINE Messaging APIのチャネルアクセストークン（長期）
  * `LINE_USER_ID`: 送信先のLINE User ID
  * ※AI要約用の環境変数は既存実装（Bedrock/Anthropic切替等）に準拠

### 3.3. Craft API フォルダ移動仕様
* **対象フォルダ**: `/daily_note_transcribe` から `/processed` へ移動
* **移動タイミング**: 要約処理およびLINE通知が正常完了した直後
* **処理内容**: 処理対象となったドキュメントのIDリストに対し、Craft API（`PATCH /api/v1/documents/{id}` 等）を実行し、folderId（またはlocation）を `/processed` のIDに変更。

### 3.4. LINE Messaging API (通知送信)
* **エンドポイント**: `POST https://api.line.me/v2/bot/message/push`
* **認証**: `Authorization: Bearer {LINE_CHANNEL_ACCESS_TOKEN}`
* **リクエストボディ例**:
  ```json
  {
    "to": "YOUR_LINE_USER_ID",
    "messages": [
      {
        "type": "text",
        "text": "{AIが生成した要約テキスト}"
      }
    ]
  }
  ```

---

## 4. 処理フロー

1. **データ取得**
   * 毎週日曜日 9:00 にLambdaが起動。Craft APIより `/daily_note_transcribe` フォルダ内の過去7日以内のノートを取得。
2. **存在チェック**
   * 対象ノートが存在しない場合、LINEへ「今週対象のノートはありませんでした」と通知し、フォルダ移動処理は行わずに正常終了。
3. **AI推論 (既存ロジック呼び出し)**
   * 既存の共通モジュール（Bedrock / Anthropic API）を実行し、要約テキストを取得。
4. **LINE通知送信**
   * LINE Messaging API の Push エンドポイントを叩き、要約文を送信。
5. **Craftノート移動（後処理）**
   * LINE通知が成功したら、今回処理した全ドキュメントの配置場所を `/daily_note_transcribe` から `/processed` フォルダへ更新。

---

## 5. エラーハンドリング・セキュリティ

* **重複防止＆安全設計**: 要約およびLINE通知が正常完了した場合のみフォルダ移動を実行するため、送信失敗時にノートが移動してしまうリスクを回避。
* **権限管理 (IAM Role)**: 既存の要約モジュールに必要なポリシー（Bedrock呼び出し権限等）および CloudWatch Logs 出力権限 (`AWSLambdaBasicExecutionRole`) を付与。
* **文字数制限**: LINEの1メッセージ上限（5,000文字）を超えないよう、AIの出力トークン数およびプロンプトで長さを調整。