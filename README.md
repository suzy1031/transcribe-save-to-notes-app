# transcribe-save-to-notes-app

Google Drive 上の手書きノート画像・Kindle スクリーンショット・家計簿 CSV を Claude API とリモート MCP サーバー経由で処理し、S3 バックエンドの Obsidian Vault への保存や LINE 通知を行う自動化パイプラインです。

## 構成

```
infra/app.js                 CDK（Lambda、Scheduler、HttpApi、Route53、S3、DynamoDB、Secrets Manager）
lambda/inbox/                デイリーノート文字起こし Lambda
lambda/weekly/               週次要約 Lambda
lambda/reminder/             週次リマインダー Lambda
lambda/csv/                  家計簿 CSV 取り込み Lambda
lambda/kindle/               Kindle 画像要約 Lambda
mcp/obsidian/                Obsidian Vault MCP サーバー定義（エントリ: mcp/index.ts, mcp/stdio.ts）
mcp/drive/                   Google Drive MCP サーバー定義・Lambda エントリ
mcp/csv/                     家計簿 CSV MCP サーバー定義・Lambda エントリ
mcp/line/                    LINE 通知 MCP サーバー定義・Lambda エントリ
mcp/usage/                   Claude 利用量 MCP サーバー定義・Lambda エントリ
mcp/                         JSON-RPC 2.0・Bearer 認証 HTTP・stdio 共通基盤
shared/                      Lambda・MCP 間で共有するドメインロジック・定数・ユーティリティ
interfaces/                  各ドメイン・共通モジュールの型定義
specifications/              設計ドキュメント・シーケンス図
.github/workflows/ci.yml     pull request で check / test、main で cdk deploy
.env.example                 ローカル実行用の環境変数テンプレート
```

## MCP の種類とツール群

5 種類のドメイン別 MCP サーバーを提供しており、API Gateway HTTP API（Bearer トークン認証・JSON-RPC 2.0）経由のリモート MCP として動作します（`obsidian-s3-mcp` は `mcp/stdio.ts` によるローカル `stdio` 起動にも対応）。

### ツール一覧

| MCP の種類（サーバー名） | ツール名 | 概要 |
| :--- | :--- | :--- |
| **Obsidian Vault**<br>(`obsidian-s3-mcp`) | `obsidian_create_note` | 指定フォルダに YAML frontmatter 付きで Markdown ノートを新規作成（同名ファイルがある場合は上書き） |
| **Obsidian Vault**<br>(`obsidian-s3-mcp`) | `obsidian_save_or_append_note` | 指定フォルダに Markdown ノートを保存（同名ノートが既に存在する場合は末尾に追記、なければ新規作成） |
| **Obsidian Vault**<br>(`obsidian-s3-mcp`) | `obsidian_list_notes` | 指定フォルダ内のノート一覧を取得（作成日 `createdDateGte` / `createdDateLte` で範囲絞り込み可能） |
| **Obsidian Vault**<br>(`obsidian-s3-mcp`) | `obsidian_read_note` | 指定キー（Vault 相対パス）の Markdown 本文（frontmatter 除去済み）を取得 |
| **Obsidian Vault**<br>(`obsidian-s3-mcp`) | `obsidian_get_app_link` | Obsidian アプリで該当ノートを直接開くディープリンク URL（`obsidian://open?...`）を生成 |
| **Google Drive**<br>(`google-drive-mcp`) | `drive_list_inbox_files` | 指定フォルダ（`images`: `00_notes_inbox` / `csv`: `csv_inbox` / `kindle`: `kindle_*`）内の未処理ファイル・フォルダ一覧を取得 |
| **Google Drive**<br>(`google-drive-mcp`) | `drive_download_file` | 指定した `fileId` のファイル内容を `base64`（画像等）または `utf8`（CSV 等）でダウンロード |
| **Google Drive**<br>(`google-drive-mcp`) | `drive_mark_as_processed` | 処理済みファイルを移動先フォルダへ移動し、任意で `appProperties` に保存先ノートキーを記録 |
| **Google Drive**<br>(`google-drive-mcp`) | `drive_cleanup_companion_texts` | 対応する画像が残っていない孤立 `.txt` ファイルを削除（403 エラー時は処理済みフォルダへ退避） |
| **家計簿 CSV**<br>(`household-csv-mcp`) | `household_format_csv_to_markdown` | 家計簿 CSV 文字列と同月の過去ノートから、週次合計・デビット合計・現金合計・月次累計付きの Markdown テーブルを生成 |
| **LINE 通知**<br>(`line-notification-mcp`) | `line_send_notification` | LINE Messaging API で Push メッセージを送信（5,000 文字を超える場合は自動で切り詰め） |
| **Claude 利用量**<br>(`claude-usage-mcp`) | `usage_get_weekly_report` | DynamoDB から今週（または指定 ISO 週）の Claude API 利用量と USD/JPY レートを取得し、円換算付きレポートを返却 |
| **Claude 利用量**<br>(`claude-usage-mcp`) | `usage_record_weekly` | 機能区分（`index` / `weekly` / `kindle`）ごとの Claude API トークン使用量を DynamoDB の週次集計レコードに加算記録 |

### リソース・プロンプト一覧

| MCP の種類（サーバー名） | 種別 | 名前 / URI | 概要 |
| :--- | :--- | :--- | :--- |
| **Obsidian Vault**<br>(`obsidian-s3-mcp`) | Resource Template | `obsidian://note/{key}` | S3 上の Obsidian Vault に保存されている Markdown ノート本文（frontmatter 除去済み） |
| **Obsidian Vault**<br>(`obsidian-s3-mcp`) | Prompt | `daily_note_transcribe_prompt` | 手書きノート文字起こしおよび Obsidian Flavored Markdown 整形ルール |
| **Obsidian Vault**<br>(`obsidian-s3-mcp`) | Prompt | `weekly_summary_prompt` | 1 週間分のデイリーノートから週次サマリーを作成するプロンプト |
| **Obsidian Vault**<br>(`obsidian-s3-mcp`) | Prompt | `kindle_highlight_summary_prompt` | Kindle スクリーンショットのハイライト判定・大文字抜粋および箇条書き補足ルール |
| **Claude 利用量**<br>(`claude-usage-mcp`) | Resource | `usage://claude/weekly` | 今週の Claude API 利用回数・トークン数・推定料金（USD / JPY）レポート |

## Lambda 一覧

Lambda はすべて Bun カスタムランタイム（`provided.al2023` / ARM64）で動作し、用途に応じて **定期実行パイプライン Lambda** と **リモート MCP サーバー Lambda** の 2 種類に分かれています。

### 定期実行パイプライン Lambda

EventBridge Scheduler で定期起動され、Claude Messages API（`mcp_servers` 指定）を通じてリモート MCP サーバー群を呼び出しながら一連のワークフローを実行します。

| 種類 | 関数名（Construct ID） | エントリポイント | スケジュール（JST） | 利用 MCP | 概要 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **デイリー文字起こし** | 自動生成<br>(`Handler`) | `lambda/inbox/index.ts` | 毎日 8:00〜11:50<br>（10 分おき） | `obsidian`<br>`drive`<br>`line` | Google Drive（`00_notes_inbox`）の手書きノート画像を取得し、Claude で文字起こしして Obsidian（`00_daily_notes`）へ保存・追記。処理済みフォルダ（`01_processed`）への移動、孤立 `.txt` の削除、LINE 通知を行い、トークン使用量を記録する |
| **週次要約** | `craft-weekly-summarizer`<br>(`WeeklySummarizer`) | `lambda/weekly/weekly.ts` | 毎週日曜 9:00 | `obsidian`<br>`line`<br>`usage` | Obsidian（`00_daily_notes`）から直近 7 日間のノートを取得して週次サマリーを作成し、`daily_note_summaries` へ保存。要約本文と今週の Claude API 利用量レポートを LINE に通知する |
| **週次リマインダー** | `craft-weekly-reminder`<br>(`WeeklyReminder`) | `lambda/reminder/reminder.ts` | 毎週日曜 9:00 | `obsidian`<br>`line` | Obsidian（`daily_note_summaries`）から 7 日前の週次まとめを検索（作成日検索＋0 件時はタイトル一致フォールバック）し、ディープリンク付きで LINE にリマインド通知する |
| **家計簿 CSV 取り込み** | `csv-spreadsheet-import`<br>(`CsvImport`) | `lambda/csv/csv-import.ts` | 毎週日曜 10:00 | `drive`<br>`csv`<br>`obsidian`<br>`line` | Google Drive（`csv_inbox`）の家計簿 CSV を取得し、同月の過去ノートを参照して各種合計・月次累計付きの Markdown テーブルへ整形。Obsidian（`household_budget`）へ保存後 `csv_processed` へ移動し、結果を LINE 通知する |
| **Kindle 画像要約** | `craft-kindle-summarizer`<br>(`KindleSummarizer`) | `lambda/kindle/kindle.ts` | 毎週月曜 6:00 | `obsidian`<br>`drive`<br>`line` | Google Drive の `kindle` 親フォルダ配下にある書籍フォルダ（`kindle_*`）からスクリーンショット画像を取得し、Claude でハイライト抜粋・要約して Obsidian（`kindle`）へ保存・追記。各書籍フォルダ内の `processed` へ移動し、LINE 通知する |

### リモート MCP サーバー Lambda

API Gateway HTTP API（カスタムドメイン `https://<サブドメイン>.<MCP_DOMAIN_NAME>/`、`POST /`）のバックエンドとして起動され、Bearer トークン認証を検証したうえで各ドメインの MCP ツール・リソース・プロンプトを提供します。

| 種類 | 関数名（Construct ID） | エントリポイント | サブドメイン | 概要 |
| :--- | :--- | :--- | :--- | :--- |
| **Obsidian Vault MCP** | `obsidian-s3-mcp`<br>(`ObsidianMcp`) | `mcp/index.ts` | `obsidian.*` | S3 バケット上の Obsidian Vault に対するノート作成・追記・一覧検索・本文読取・ディープリンク生成と、文字起こし／要約プロンプトの提供 |
| **Google Drive MCP** | `google-drive-mcp`<br>(`DriveMcp`) | `mcp/drive/index.ts` | `drive.*` | Google Drive の対象フォルダからの未処理ファイル一覧取得、ファイルダウンロード、処理済みフォルダへの移動、不要な `.txt` ファイルの削除 |
| **家計簿 CSV MCP** | `household-csv-mcp`<br>(`CsvMcp`) | `mcp/csv/index.ts` | `csv.*` | 家計簿 CSV のパースおよび週次合計・デビット合計・現金合計・月次累計を計算した Markdown テーブルへの変換 |
| **LINE 通知 MCP** | `line-notification-mcp`<br>(`LineMcp`) | `mcp/line/index.ts` | `line.*` | LINE Messaging API を用いたユーザーへの Push メッセージ送信 |
| **Claude 利用量 MCP** | `claude-usage-mcp`<br>(`UsageMcp`) | `mcp/usage/index.ts` | `usage.*` | DynamoDB（`notes-pipeline-claude-usage`）への週次トークン利用量の加算記録と、USD/JPY 為替レートを反映した週次利用料金レポートの生成 |

## コマンド

```sh
bun install
bun run check
bun run typecheck
bun run test
bunx cdk synth
bunx cdk deploy
```
