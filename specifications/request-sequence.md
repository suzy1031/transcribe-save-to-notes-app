# リクエストシーケンス

各 Lambda のエントリポイントと外部連携の流れ。インフラ定義は `infra/app.js`、処理本体は `lambda/` を参照。

## Lambda 一覧

| CDK 論理 ID | 関数名 | エントリ | スケジュール (JST) |
|-------------|--------|----------|-------------------|
| Handler | (スタック生成名) | `lambda/inbox/index.ts` | 毎日 8:00–11:50、10分間隔 |
| WeeklySummarizer | `craft-weekly-summarizer` | `lambda/weekly/weekly.ts` | 毎週日曜 9:00 |
| WeeklyReminder | `craft-weekly-reminder` | `lambda/reminder/reminder.ts` | 毎週日曜 9:00 |
| CsvImport | `csv-spreadsheet-import` | `lambda/csv/csv-import.ts` | 毎週日曜 10:00 |
| KindleSummarizer | `craft-kindle-summarizer` | `lambda/kindle/kindle.ts` | 毎週月曜 6:00 |

共通: Secrets Manager (`SECRET_ID`)、ランタイムは Bun (`provided.al2023` / `arm64`)、`TRANSCRIPTION_PROVIDER` は `claude` または `bedrock`。

---

## Handler — 朝の文字起こしパイプライン (`lambda/inbox/index.ts`)

Google Drive の `00_notes_inbox` 内画像を文字起こしし、Obsidian Vault 用 S3 バケットの `00_daily_notes` に保存（既存があれば追記）。処理済みは `01_processed` へ移動。成功・失敗を LINE に通知（資格情報が無い場合はログのみ）。

```mermaid
sequenceDiagram
    autonumber
    actor Scheduler as EventBridge Scheduler<br/>(8–11時 JST / 10分)
    participant Handler as lambda/inbox/index.ts
    participant SM as Secrets Manager
    participant Drive as Google Drive<br/>(drive/drive.ts)
    participant Transcribe as transcribe/<br/>(claude or bedrock)
    participant Parse as transcribe/parse.ts
    participant Obsidian as Obsidian S3<br/>(obsidian/obsidian.ts)
    participant Line as LINE Push<br/>(line/line.ts)

    Scheduler->>Handler: Invoke handler
    Handler->>SM: GetSecretValue (SECRET_ID)
    SM-->>Handler: googleServiceAccount, line, anthropicApiKey

    Handler->>Drive: findUniqueFolder(00_notes_inbox, 01_processed)
    alt フォルダ解決失敗
        Handler->>Line: transcriptionFailedMessage(inbox)
        Handler-->>Scheduler: folderLookup failed
    end

    Handler->>Drive: listImages(inbox), listTextFiles(inbox)

    loop processInbox — 各画像（残り60秒未満で打切り）
        alt appProperties.craftDocumentId あり
            Handler->>Drive: moveToProcessed + craftDocumentId
            Handler->>Drive: 同名 stem の txt 削除/移動
        else 新規処理
            Handler->>Drive: download(image)
            alt 画像サイズ超過
                Handler->>Line: transcriptionFailedMessage
            else 文字起こし
                Handler->>Transcribe: transcribe(bytes, mimeType)
                alt provider=claude
                    Transcribe->>Transcribe: Anthropic Messages API
                else provider=bedrock
                    Transcribe->>Transcribe: Bedrock Converse
                end
                Transcribe->>Parse: parseTranscription(JSON)
                Parse-->>Transcribe: { title, markdown }
                Transcribe-->>Handler: note
                Handler->>Obsidian: saveOrAppendNote(00_daily_notes, title, markdown)
                Handler->>Drive: moveToProcessed(noteKey)
                Handler->>Drive: 同名 stem の txt 削除/移動
                Handler->>Line: transcriptionSavedMessage + Obsidian アプリリンク
            end
        end
        opt 処理失敗
            Handler->>Line: transcriptionFailedMessage
        end
    end

    Handler->>Drive: 孤児 txt の後処理 (orphanTextFiles)
    Handler-->>Scheduler: { processed, failed, skipped, deferred }
```

---

## WeeklySummarizer — 週次要約 (`lambda/weekly/weekly.ts`)

Obsidian S3 バケットの `00_daily_notes` 内の直近7日分ノートを要約し LINE に送信。同内容を `daily_note_summaries` に保存する（`00_daily_notes` の元ノートは移動しない）。さらに DynamoDB（`ClaudeUsage`）から当週の Claude 利用量を取得し、為替レート（`claude/fx-rate.ts`）で円換算して LINE に通知。

```mermaid
sequenceDiagram
    autonumber
    actor Scheduler as EventBridge Scheduler<br/>(日曜 9:00 JST)
    participant Weekly as lambda/weekly/weekly.ts
    participant SM as Secrets Manager
    participant Obsidian as Obsidian S3<br/>(obsidian/obsidian.ts)
    participant Prompt as summarize/summary-prompt.ts<br/>(combineNotes)
    participant Summarize as summarize/summarize.ts<br/>(claude or bedrock)
    participant Usage as DynamoDB ClaudeUsage<br/>(claude/claude-usage.ts)
    participant Fx as 為替レート API<br/>(claude/fx-rate.ts)
    participant Line as LINE Push<br/>(line/line.ts)

    Scheduler->>Weekly: Invoke handler
    Weekly->>SM: GetSecretValue (SECRET_ID)
    SM-->>Weekly: line, anthropicApiKey

    Weekly->>Obsidian: listNotes(00_daily_notes, createdDateGte = 7日前)

    alt ドキュメント 0 件
        Weekly->>Line: EMPTY_WEEK_MESSAGE
    else 1 件以上
        loop 各ドキュメント
            Weekly->>Obsidian: readMarkdown(key)
        end
        Weekly->>Prompt: combineNotes(notes)
        Prompt-->>Weekly: 結合テキスト
        Weekly->>Summarize: summarize(notesText)
        alt provider=claude
            Summarize->>Summarize: Anthropic (Haiku) + summaryPrompt
        else provider=bedrock
            Summarize->>Summarize: Bedrock Converse + summaryPrompt
        end
        Summarize-->>Weekly: 週次要約テキスト
        Weekly->>Line: push(fitLineText(summary))
        Weekly->>Obsidian: createNote(daily_note_summaries, 週次まとめ YYYY-MM-DD)
    end

    Weekly->>Usage: getWeeklyUsage(now)
    Usage-->>Weekly: WeeklyUsageItem (または null)
    opt 当週の利用記録あり
        Weekly->>Fx: fetchUsdJpyRate()
        Fx-->>Weekly: usdJpyRate
        Weekly->>Usage: formatWeeklyUsage(item, usdJpyRate)
        Weekly->>Line: push(Claude利用量サマリー)
    end
    Weekly-->>Scheduler: { summarized }
```

---

## WeeklyReminder — 週次リマインド (`lambda/reminder/reminder.ts`)

`daily_note_summaries` 内で「実行日の7日前」に作成されたノートを1件だけ LINE で再通知（タイトル + Obsidian アプリリンク）。

```mermaid
sequenceDiagram
    autonumber
    actor Scheduler as EventBridge Scheduler<br/>(日曜 9:00 JST)
    participant Reminder as lambda/reminder/reminder.ts
    participant SM as Secrets Manager
    participant Obsidian as Obsidian S3<br/>(obsidian/obsidian.ts)
    participant Line as LINE Push<br/>(line/line.ts)

    Scheduler->>Reminder: Invoke handler
    Reminder->>SM: GetSecretValue (SECRET_ID)
    SM-->>Reminder: line

    Note over Reminder: targetDate = 今日(JST) − 7日
    Reminder->>Obsidian: listNotes(daily_note_summaries, createdDateGte/Lte = targetDate)
    opt 作成日0件
        Reminder->>Obsidian: listNotes(daily_note_summaries, createdDateGte=全期間)
        Note over Reminder: タイトル「週次まとめ {targetDate}」で絞り込み
    end

    alt 0 件（作成日・タイトルとも）
        Reminder->>Line: EMPTY_REMINDER_MESSAGE
        Reminder-->>Scheduler: { reminded: 0 }
    else 2 件以上
        Reminder-->>Reminder: Error (件数不一致)
        Reminder->>Line: reminderFailedMessage
        Reminder-->>Scheduler: throw
    else ちょうど 1 件
        Reminder->>Line: reminderDeliveredMessage(title, appLink)
        Reminder-->>Scheduler: { reminded: 1, documentId }
    end

    opt handler 全体の例外
        Reminder->>Line: reminderFailedMessage
    end
```

---

## KindleSummarizer — Kindle スクリーンショット要約 (`lambda/kindle/kindle.ts`)

Drive `kindle` 配下の `kindle_*` フォルダ内画像を Vision 要約し、S3 の `kindle/{書籍フォルダ名}.md` へ新規作成または末尾追記する。成功した画像は各 `kindle_*/processed` へ移動。

```mermaid
sequenceDiagram
    autonumber
    actor Scheduler as EventBridge Scheduler<br/>(月曜 6:00 JST)
    participant Kindle as lambda/kindle/kindle.ts
    participant SM as Secrets Manager
    participant Drive as Google Drive<br/>(drive/drive.ts)
    participant Summarize as kindle/kindle-summarize.ts<br/>(claude or bedrock)
    participant Prompt as kindle/kindle-prompt.ts
    participant Obsidian as Obsidian S3<br/>(obsidian/obsidian.ts)
    participant Line as LINE Push<br/>(line/line.ts)

    Scheduler->>Kindle: Invoke handler
    Kindle->>SM: GetSecretValue (SECRET_ID)
    SM-->>Kindle: googleServiceAccount, line, anthropicApiKey

    Kindle->>Drive: findUniqueFolder(kindle)
    alt 親フォルダ解決失敗
        Kindle->>Line: kindleFailedMessage
        Kindle-->>Scheduler: folderLookup failed
    end

    Kindle->>Drive: listKindleBookFolders(kindle_*)

    loop processKindleBooks — 各 kindle_*（残り60秒未満で打切り）
        Kindle->>Drive: listImages(bookFolder)
        alt 画像なし
            Kindle->>Kindle: continue
        else 画像あり
            Kindle->>Drive: ensureChildFolder(processed)
            loop 各画像
                Kindle->>Drive: download
                Kindle->>Summarize: summarizeImage(bytes, mimeType)
                Summarize->>Prompt: KINDLE_SYSTEM / USER
                alt provider=claude
                    Summarize->>Summarize: Anthropic Messages (Vision)
                else provider=bedrock
                    Summarize->>Summarize: Bedrock Converse (Vision)
                end
                Summarize-->>Kindle: markdown
                Kindle->>Obsidian: saveOrAppendNote(kindle, bookFolder.name, markdown)
                Kindle->>Drive: moveFile → processed
            end
        end
    end

    opt 要約または失敗が1枚以上
        Kindle->>Line: kindleRunSummaryMessage(件数 + Obsidian リンク)
    end
    Kindle-->>Scheduler: summary オブジェクト
```

---

## CsvImport — 家計簿 CSV を Obsidian Markdown テーブルへ取り込む (`lambda/csv/csv-import.ts`)

Drive の `csv_inbox` にある CSV を読み、合計・デビット・現金・月次累計行を付与した Markdown テーブルとして S3 の `household_budget/{YYYY-MM-DD}_{stem}.md` に保存する。成功したファイルだけ `csv_processed` へ移動する。0件は LINE に「今週対象のCSVはありませんでした」。1件以上は成功件数、失敗件数、Obsidian アプリリンク（`obsidian://open?...`）、失敗ファイルを1通で通知する。同名ノートがあるファイルは上書きしない。

```mermaid
sequenceDiagram
    autonumber
    actor Scheduler as EventBridge Scheduler<br/>(日曜 10:00 JST)
    participant Csv as lambda/csv/csv-import.ts
    participant SM as Secrets Manager
    participant Drive as Google Drive<br/>(drive/drive.ts)
    participant Parse as csv/csv.ts
    participant Obsidian as Obsidian S3<br/>(obsidian/obsidian.ts)
    participant Line as LINE Push<br/>(line/line.ts)

    Scheduler->>Csv: handler
    Csv->>SM: GetSecretValue
    SM-->>Csv: googleServiceAccount, line
    Csv->>Drive: findUniqueFolder(csv_inbox, csv_processed)
    alt フォルダが一意でない
        Csv->>Line: csvImportFailedMessage
    else フォルダあり
        Csv->>Drive: listCsvFiles
        alt CSVが0件
            Csv->>Line: 今週対象のCSVはありませんでした
        else 1件以上
            Csv->>Obsidian: listNotes(household_budget)
            loop 各CSV
                alt 同名ノートあり
                    Csv->>Csv: 失敗として残す
                else 新規
                    Csv->>Drive: download
                    Csv->>Parse: parseCsv + 集計 + rowsToMarkdownTable
                    Csv->>Obsidian: createNote(household_budget/{date}_{stem}.md)
                    Csv->>Drive: moveFile → csv_processed
                end
            end
            Csv->>Line: csvImportSummaryMessage
        end
    end
    Csv-->>Scheduler: imported / failed
```

---

## モジュール対応表（Lambda 横断）

| モジュール | Handler | Weekly | Reminder | Kindle | Csv |
|------------|:-------:|:------:|:--------:|:------:|:---:|
| `drive/drive.ts` + `drive/helper.ts` | ○ | — | — | ○ | ○ |
| `obsidian/obsidian.ts` + `obsidian/helper.ts` | ○ | ○ | ○ | ○ | ○ |
| `line/line.ts` + `line/helper.ts` | ○ | ○ | ○ | ○ | ○ |
| `claude/claude-usage.ts` + `claude/fx-rate.ts` | ○ | ○ | — | ○ | — |
| `transcribe/*` | ○ | — | — | ○ | — |
| `summarize/summarize.ts` + `summarize/summary-prompt.ts` | — | ○ | — | — | — |
| `kindle/kindle-summarize.ts` + `kindle/kindle-prompt.ts` | — | — | — | ○ | — |
| `csv/csv.ts` + `csv/helper.ts` | — | — | — | — | ○ |
| `shared/*` | ○ | ○ | ○ | ○ | ○ |
