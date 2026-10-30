# 手書きノート自動認識・Craft連携システム システム詳細設計書

本設計書は、iPad（GoodNotes等）で書き出した手書きノート画像を、Google Drive経由でVision LLM（GPT-4o mini等）に渡し、文字認識・誤字校正を行ったうえで Craft に自動登録するパイプラインの仕様を定義するものです。

---

## 1. システム概要・アーキテクチャ

### 1.1 全体構成図

```
[iPad / GoodNotes 等]
   │ 手書きノートを画像 (PNG / JPEG) で書き出し
   ▼
[Google Drive] (/00_notes_inbox フォルダ)
   │
   │ (毎朝 JST 8:00〜11:50 の間、10分おきに自動起動)
   ▼
[AWS EventBridge]
   │ Cronトリガー
   ▼
[AWS Lambda]
   │ 1. Google Drive API で画像ファイル (.png/.jpg) のみを取得
   │ 2. Vision LLM (GPT-4o mini等) に画像を Base64 送信
   │    └ 1リクエストで「文字読み取り・誤字校正・Markdown化」を完結
   │ 3. Craft API を呼び出し、Markdownテキストとして新規ドキュメント登録
   │ 4. 処理済み画像を Google Drive 内の `/01_processed` フォルダへ移動
   ▼
[Craft]
```

---

## 2. システム構成要素

| コンポーネント | 採用技術・サービス | 役割と詳細仕様 |
| :--- | :--- | :--- |
| **クライアント** | iPad (GoodNotes, 純正メモ等) | 手書きノートを作成し、PNG または JPEG 画像として書き出し |
| **ストレージ** | Google Drive | 受信フォルダ (`/00_notes_inbox`) および処理済みフォルダ (`/01_processed`) を管理 |
| **スケジューラ** | AWS EventBridge | 毎朝の指定時間帯のみ10分間隔でLambdaを呼び出す定期実行トリガー |
| **バックエンド** | AWS Lambda (Node.js / Python) | Google Driveからの取得、LLM解析、Craft API連携、ファイル移動 |
| **解析エンジン** | Vision LLM (GPT-4o mini / Claude 3.5) | 画像データから手書き文字を直接認識・校正し、Markdown形式で出力 |
| **登録先** | Craft (Craft Connect API) | 生成されたタイトルおよびMarkdownテキストを受け取りドキュメントを新規作成 |

---

## 3. 詳細仕様

### 3.1 Google Drive フォルダ構造 & ファイルフィルタリング

* **フォルダ構成**:
  * `/00_notes_inbox` : iPadからの書き出し先（監視対象フォルダ）
  * `/01_processed` : 処理完了後の移動先フォルダ

* **ファイル抽出条件**:
  * Drive API 呼び出し時に `mimeType = 'image/jpeg' or mimeType = 'image/png'` クエリを指定し、画像ファイル以外（PDF、HEIC、テキストファイル等）を除外する。
  * プログラム側でも拡張子 (`.png`, `.jpg`, `.jpeg`) のダブルチェックを実施。

---

### 3.2 EventBridge スケジュール設定（Cron式）

午前中のみ稼働させることで、不必要な呼び出し・ログ・API使用を最小限に抑えます。

* **実行間隔**: 日本時間（JST）**08:00 〜 11:50**（10分おき）
* **AWS Cron表現式 (UTC記法)**: `cron(0/10 23,0-2 * * ? *)`

> **補足**: 午後〜夜間に Google Drive に保存された画像はそのまま保持され、翌朝 08:00 の最初のバッチ処理でまとめて取り込まれます。

---

### 3.3 Vision LLM プロンプト設計

LLM（GPT-4o mini 等）に画像と併せて送信するシステムプロンプト定義です。

```json
{
  "role": "system",
  "content": "あなたは手書き文字の書き起こしおよび文書整形の専門家です。提供された手書きノート画像から文字を精度高く読み取り、誤字脱字や文脈の不整合を補正した上で、以下のJSONフォーマットのみで出力してください。\n\nフォーマット:\n{\n  \"title\": \"ノートの内容を表す簡潔なタイトル\",\n  \"markdown\": \"補正済みの本文（適宜、見出しや箇条書き等のMarkdown記法を使用）\"\n}"
}
```

---

### 3.4 Craft API 連携仕様

Craft Connect API を使用して、LLMが生成したタイトルと Markdown 本文を流し込みます。Notion と異なり複雑な Block オブジェクトの構築が不要で、Markdown をそのまま直接渡すことができます。

* **エンドポイント例**: `POST https://connect.craft.do/api/v1/documents`
* **ヘッダー**: 
  * `Authorization: Bearer <CRAFT_API_KEY>`
  * `Content-Type: application/json`
* **ペイロード例**:
```json
{
  "title": "解析されたタイトル",
  "content": "## 見出し\n\n校正された本文テキスト..."
}
```

---

## 4. 処理フロー

1. **[iPad] ノート出力**:
   GoodNotes 等でノートを作成し、PNG または JPEG で Google Drive の `/00_notes_inbox` へ保存。
2. **[EventBridge] 起動判定**:
   JST 8:00〜11:50 の間、10分おきに Lambda を起動。
3. **[Lambda] 画像取得**:
   Google Drive API（サービスアカウント認証）で `/00_notes_inbox` 内の未処理画像 (`.png` / `.jpg`) を検索・読み込み。
4. **[Lambda ➔ LLM] 解析実行**:
   画像を Base64 化して Vision LLM API にリクエストを送信。タイトルと Markdown 本文を取得。
5. **[Lambda ➔ Craft] ノート登録**:
   Craft API を呼び出し、新規ドキュメントを作成。
6. **[Lambda ➔ Google Drive] 整理**:
   二重処理を防ぐため、処理成功した画像を `/01_processed` フォルダへ移動。

---

## 5. コスト・運用面のメリット

* **完全無料枠内のインフラ運用**:
  AWS Lambda, EventBridge, Google Drive API の利用費用は個人利用規模であれば全額無料枠に収まります（月額 0 円）。
* **LLM コストの最適化**:
  GPT-4o mini を採用した場合、画像1枚あたり約 0.05〜0.1 円程度で稼働可能。
* **メンテナンスフリー**:
  7日間の有効期限更新が必要な Webhook 方式ではなく Cron 方式のため、トークン切れ等の運用エラーが発生しません。