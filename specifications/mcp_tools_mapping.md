# 自作 MCP 化に向けた既存機能と MCP ツール群の対応一覧

## 概要

本ドキュメントは、本リポジトリで実装済みの機能（5 つの定期実行 Lambda パイプラインおよび 6 つのドメインモジュール）と、それらを自作 MCP（Model Context Protocol）サーバー化した場合の **Tools / Prompts / Resources** の対応関係を整理した一覧である。

---

## 1. 既存ドメイン機能 ⇔ MCP 要素（Tools / Prompts / Resources）の紐付け一覧

### ① Obsidian (S3 Vault) ドメイン（`lambda/obsidian/obsidian.ts`, `helper.ts`）

最も MCP 化の恩恵が大きく、最初に構築するコア領域。

| 現在の実装（関数・処理） | MCP での種別 | MCP ツール / リソース名（案） | 役割・引数イメージ |
| :--- | :--- | :--- | :--- |
| `obsidian.createNote()` | **Tool** | `obsidian_create_note` | 指定フォルダに frontmatter 付きで新規 Markdown ノートを作成（上書き） |
| `obsidian.saveOrAppendNote()` | **Tool** | `obsidian_save_or_append_note` | 既存ノートがあれば末尾に追記、なければ新規作成（デイリー・Kindle 用） |
| `obsidian.listNotes()` | **Tool** | `obsidian_list_notes` | フォルダ名・期間（`createdDateGte` / `createdDateLte`）でノート一覧を検索 |
| `obsidian.readMarkdown()` | **Tool** / **Resource** | `obsidian_read_note` / `obsidian://note/{key}` | 指定した S3 キーのノート本文（frontmatter 除去済み）を取得 |
| `obsidianAppNoteLink()` | **Tool**（または上記戻り値に同梱） | `obsidian_get_app_link` | `obsidian://open?vault=...&file=...` のアプリ起動 URL を生成 |

---

### ② プロンプト・ルール群（`lambda/transcribe`, `lambda/summarize`, `lambda/kindle`）

各ドメインに配置されているプロンプト定数を MCP の **`Prompts`** として一元化できる。

| 現在の実装（定数・関数） | MCP での種別 | MCP プロンプト名（案） | 内容 |
| :--- | :--- | :--- | :--- |
| `SYSTEM_PROMPT`（`lambda/transcribe/prompt.ts`） | **Prompt** | `daily_note_transcribe_prompt` | 手書きノート文字起こし＋Obsidian Flavored Markdown 整形ルール |
| `SUMMARY_SYSTEM_PROMPT`（`lambda/summarize/summary-prompt.ts`） | **Prompt** | `weekly_summary_prompt` | 1 週間分のデイリーノートから週次サマリーを作るプロンプト |
| `KINDLE_SYSTEM_PROMPT` / `KINDLE_USER_PROMPT`（`lambda/kindle/kindle-prompt.ts`） | **Prompt** | `kindle_highlight_summary_prompt` | Kindle スクショのハイライト判定・大文字抜粋＋箇条書き補足ルール |

---

### ③ Google Drive ドメイン（`lambda/drive/drive.ts`, `helper.ts`）

Google Drive の入出力を MCP ツール化することで、画像や CSV の取得から処理済みフォルダへの移動までをツール呼び出しとして扱える。

| 現在の実装（関数・処理） | MCP での種別 | MCP ツール名（案） | 役割・引数イメージ |
| :--- | :--- | :--- | :--- |
| `findUniqueFolder()` + `listImages()` / `listCsvFiles()` / `listKindleBookFolders()` | **Tool** | `drive_list_inbox_files` | 指定フォルダ（`inbox` / `csv_inbox` / `kindle_*`）内の未処理ファイル一覧を取得 |
| `download()` | **Tool** | `drive_download_file` | `fileId` からファイル（画像 base64 または CSV テキスト）を取得 |
| `moveToProcessed()` / `moveFile()` | **Tool** | `drive_mark_as_processed` | 処理済みフォルダへ移動し、`appProperties`（保存先ノートキー等）を記録 |
| `deleteFile()` + `orphanTextFiles()` | **Tool** | `drive_cleanup_companion_texts` | 画像と同名の不要な `.txt` ファイルを削除（403 時は処理済みフォルダへ移動） |

---

### ④ 家計簿 CSV 集計ドメイン（`lambda/csv/csv.ts`, `helper.ts`）

金額計算の正確性を保つため、計算ロジック自体は TypeScript 関数のまま MCP ツールとしてラップする。

| 現在の実装（関数・処理） | MCP での種別 | MCP ツール名（案） | 役割・引数イメージ |
| :--- | :--- | :--- | :--- |
| `parseCsv()` + `append*TotalRow()` + `rowsWithCumulative()` + `rowsToMarkdownTable()` | **Tool** | `household_format_csv_to_markdown` | CSV 文字列と過去ノート行を受け取り、週次合計・月次累計付きの Markdown テーブルを返す |

---

### ⑤ LINE 通知ドメイン（`lambda/line/line.ts`, `helper.ts`）

| 現在の実装（関数・処理） | MCP での種別 | MCP ツール名（案） | 役割・引数イメージ |
| :--- | :--- | :--- | :--- |
| `line.push()` + 各メッセージ整形ヘルパー | **Tool** | `line_send_notification` | 通知種別（保存完了 / エラー / 週次まとめ / リマインダー / CSV 結果）に応じた LINE Push を送信 |

---

### ⑥ Claude 利用料集計ドメイン（`lambda/claude/claude-usage.ts`, `fx-rate.ts`）

| 現在の実装（関数・処理） | MCP での種別 | MCP ツール / リソース名（案） | 役割・引数イメージ |
| :--- | :--- | :--- | :--- |
| `getWeeklyUsage()` + `fetchUsdJpyRate()` + `formatWeeklyUsage()` | **Tool** / **Resource** | `usage_get_weekly_report` / `usage://claude/weekly` | DynamoDB の利用トークン数と最新ドル円レートから今週の API 利用料（USD/JPY）を取得 |
| `resetWeeklyUsage()` | **Tool** | `usage_reset_weekly` | 週次レポート送信後に DynamoDB の集計カウンタをリセット |

---

## 2. 現行の 5 つの定期 Lambda バッチから見た変化

上記を MCP サーバー（例：`notes-pipeline-mcp`）にまとめた場合、`infra/app.js` で定義されている 5 つの定期実行 Lambda の処理フローは以下の通り変化する。

| 定期 Lambda 名（スケジュール） | 現在の処理 | MCP 化後のイメージ |
| :--- | :--- | :--- |
| **1. `Handler` / デイリー文字起こし**<br>(`lambda/inbox/index.ts`)<br>毎日 8〜11時 / 10分おき | Drive 取得 → Claude 文字起こし → S3 保存 → Drive 移動 → LINE 通知 | `daily_note_transcribe_prompt` を取得し、Claude（または MCP Client）が `drive_*` → `obsidian_save_or_append_note` → `line_send_notification` を呼ぶ |
| **2. `WeeklySummarizer` / 週次要約**<br>(`lambda/weekly/weekly.ts`)<br>日曜 9:00 | S3 一覧・読込 → Claude 要約 → LINE 通知 → S3 保存 → 利用料通知＆リセット | `obsidian_list_notes` & `obsidian_read_note` → `weekly_summary_prompt` で要約 → `obsidian_create_note` → `usage_get_weekly_report` → `line_send_notification` |
| **3. `WeeklyReminder` / リマインダー**<br>(`lambda/reminder/reminder.ts`)<br>日曜 9:00 | 7日前の週次まとめを S3 から検索（作成日→タイトルフォールバック）→ LINE 通知 | `obsidian_list_notes` で 7 日前のまとめを検索 → `line_send_notification` |
| **4. `CsvImport` / 家計簿 CSV**<br>(`lambda/csv/csv-import.ts`)<br>日曜 10:00 | Drive から CSV 取得 → 集計＆累計計算 → S3 保存 → Drive 移動 → LINE 通知 | `drive_list_inbox_files` → `household_format_csv_to_markdown` → `obsidian_create_note` → `drive_mark_as_processed` → `line_send_notification` |
| **5. `KindleSummarizer` / Kindle 要約**<br>(`lambda/kindle/kindle.ts`)<br>月曜 6:00 | Drive の `kindle_*` 画像取得 → Claude 要約 → S3 追記保存 → Drive 移動 | `kindle_highlight_summary_prompt` を使って要約 → `obsidian_save_or_append_note` → `drive_mark_as_processed` |

---

## 3. 段階的な実装アプローチ（推奨）

最初から全ドメイン（①〜⑥）を 1 つの MCP に統合するよりも、以下の順序で段階的に進めるのが安全かつ学習効率が高い。

1. **Step 1**: **① Obsidian (S3 Vault) ＋ ② プロンプト群** を MCP サーバー化（Tools 4 個・Prompts 3 個・Resources 1 個）
2. **Step 2**: ローカル（`stdio`）および AWS Lambda（`Streamable HTTP`）の両エントリポイントを作成して動作確認
3. **Step 3**: 必要に応じて ③ Google Drive / ④ 家計簿 CSV / ⑤ LINE / ⑥ 利用料集計を順次ツールとして追加
