# リクエストシーケンス

各 Lambda のエントリポイントと外部連携の流れ。インフラ定義は `infra/app.js`、処理本体は `lambda/` を参照。

## Lambda 一覧

| CDK 論理 ID | 関数名 | エントリ | スケジュール (JST) |
|-------------|--------|----------|-------------------|
| Handler | (スタック生成名) | `lambda/index.js` | 毎日 8:00–11:50、10分間隔 |
| WeeklySummarizer | `craft-weekly-summarizer` | `lambda/weekly.js` | 毎週日曜 9:00 |
| WeeklyReminder | `craft-weekly-reminder` | `lambda/reminder.js` | 毎週日曜 9:00 |
| KindleSummarizer | `craft-kindle-summarizer` | `lambda/kindle.js` | 毎週月曜 6:00 |

共通: Secrets Manager (`SECRET_ID`)、`TRANSCRIPTION_PROVIDER` は `claude` または `bedrock`。

---

## Handler — 朝の文字起こしパイプライン (`lambda/index.js`)

Google Drive の `00_notes_inbox` 内画像を文字起こしし Craft の `daily_note_transcribe` に保存。処理済みは `01_processed` へ移動。成功・失敗を LINE に通知（資格情報が無い場合はログのみ）。

```mermaid
sequenceDiagram
    autonumber
    actor Scheduler as EventBridge Scheduler<br/>(8–11時 JST / 10分)
    participant Handler as lambda/index.js
    participant SM as Secrets Manager
    participant Drive as Google Drive<br/>(drive.js)
    participant Transcribe as transcribe/<br/>(claude or bedrock)
    participant Parse as transcribe/parse.js
    participant Craft as Craft API<br/>(craft.js)
    participant Line as LINE Push<br/>(line.js)

    Scheduler->>Handler: Invoke handler
    Handler->>SM: GetSecretValue (SECRET_ID)
    SM-->>Handler: googleServiceAccount, craft, line, anthropicApiKey

    Handler->>Drive: findUniqueFolder(00_notes_inbox, 01_processed)
    alt フォルダ解決失敗
        Handler->>Line: transcriptionFailedMessage(inbox)
        Handler-->>Scheduler: folderLookup failed
    end

    Handler->>Drive: listImages(inbox), listTextFiles(inbox)
    Handler->>Craft: getConnection (spaceId 取得)

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
                Handler->>Craft: ensureFolder(daily_note_transcribe)
                Handler->>Craft: createDocument(title, markdown)
                Handler->>Drive: moveToProcessed(craftDocumentId)
                Handler->>Drive: 同名 stem の txt 削除/移動
                Handler->>Line: transcriptionSavedMessage + Craft アプリリンク
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

## WeeklySummarizer — 週次要約 (`lambda/weekly.js`)

Craft `daily_note_transcribe` 内の直近7日分ドキュメントを要約し LINE に送信。同内容を `daily_note_summaries` に保存後、元ドキュメントを Craft `processed` へ移動。

```mermaid
sequenceDiagram
    autonumber
    actor Scheduler as EventBridge Scheduler<br/>(日曜 9:00 JST)
    participant Weekly as lambda/weekly.js
    participant SM as Secrets Manager
    participant Craft as Craft API<br/>(craft.js)
    participant Prompt as summary-prompt.js<br/>(combineNotes)
    participant Summarize as summarize.js<br/>(claude or bedrock)
    participant Line as LINE Push<br/>(line.js)

    Scheduler->>Weekly: Invoke handler
    Weekly->>SM: GetSecretValue (SECRET_ID)
    SM-->>Weekly: craft, line, anthropicApiKey

    Weekly->>Craft: findFolder(daily_note_transcribe)
    Weekly->>Craft: listDocuments(createdDateGte = 7日前)

    alt ドキュメント 0 件
        Weekly->>Line: EMPTY_WEEK_MESSAGE
        Weekly-->>Scheduler: { summarized: 0, moved: 0 }
    else 1 件以上
        loop 各ドキュメント
            Weekly->>Craft: readMarkdown(documentId)
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
        Weekly->>Craft: ensureFolder(daily_note_summaries)
        Weekly->>Craft: createDocument(週次まとめ YYYY-MM-DD)
        Weekly->>Craft: ensureFolder(processed)
        Weekly->>Craft: moveDocuments → processed
        Weekly-->>Scheduler: { summarized, moved }
    end
```

---

## WeeklyReminder — 週次リマインド (`lambda/reminder.js`)

`daily_note_summaries` 内で「実行日の7日前」に作成されたノートを1件だけ LINE で再通知（タイトル + Craft アプリリンク）。

```mermaid
sequenceDiagram
    autonumber
    actor Scheduler as EventBridge Scheduler<br/>(日曜 9:00 JST)
    participant Reminder as lambda/reminder.js
    participant SM as Secrets Manager
    participant Craft as Craft API<br/>(craft.js)
    participant Line as LINE Push<br/>(line.js)

    Scheduler->>Reminder: Invoke handler
    Reminder->>SM: GetSecretValue (SECRET_ID)
    SM-->>Reminder: craft, line

    Reminder->>Craft: findFolder(daily_note_summaries)
    Reminder->>Craft: getConnection (spaceId)
    Note over Reminder: targetDate = 今日(JST) − 7日
    Reminder->>Craft: listDocuments(createdDateGte/Lte = targetDate)

    alt 0 件
        Reminder->>Line: EMPTY_REMINDER_MESSAGE
        Reminder-->>Scheduler: { reminded: 0 }
    else 2 件以上
        Reminder-->>Reminder: Error (件数不一致)
        Reminder->>Line: reminderFailedMessage
        Reminder-->>Scheduler: throw
    else ちょうど 1 件
        Reminder->>Line: transcriptionSavedMessage(title, appLink)
        Reminder-->>Scheduler: { reminded: 1, documentId }
    end

    opt handler 全体の例外
        Reminder->>Line: reminderFailedMessage
    end
```

---

## KindleSummarizer — Kindle スクリーンショット要約 (`lambda/kindle.js`)

Drive `kindle` 配下の `kindle_*` フォルダ内画像を Vision 要約し、Craft に同名フォルダがあれば「要約」ドキュメントへ追記（無ければ新規、2件以上あればその書籍フォルダはスキップ）。成功した画像は各 `kindle_*/processed` へ移動。

```mermaid
sequenceDiagram
    autonumber
    actor Scheduler as EventBridge Scheduler<br/>(月曜 6:00 JST)
    participant Kindle as lambda/kindle.js
    participant SM as Secrets Manager
    participant Drive as Google Drive<br/>(drive.js)
    participant Summarize as kindle-summarize.js<br/>(claude or bedrock)
    participant Prompt as kindle-prompt.js
    participant Craft as Craft API<br/>(craft.js)
    participant Line as LINE Push<br/>(line.js)

    Scheduler->>Kindle: Invoke handler
    Kindle->>SM: GetSecretValue (SECRET_ID)
    SM-->>Kindle: googleServiceAccount, craft, line, anthropicApiKey
    Kindle->>Craft: getConnection (spaceId)

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
        end
        Kindle->>Craft: findFolder(書籍フォルダ名)
        alt Craft フォルダなし
            Kindle->>Kindle: foldersSkippedNoCraft++
        else Craft あり
            Kindle->>Craft: listDocuments(要約 0/1 件判定)
            alt 要約ドキュメント 2 件以上
                Kindle->>Kindle: errors に記録して skip
            else 0 または 1 件
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
                    alt 要約ドキュメント未作成
                        Kindle->>Craft: createDocument(要約)
                    else 既存あり
                        Kindle->>Craft: appendMarkdown
                    end
                    Kindle->>Drive: moveFile → processed
                end
            end
        end
    end

    opt 要約または失敗が1枚以上
        Kindle->>Line: kindleRunSummaryMessage(件数 + Craft リンク)
    end
    Kindle-->>Scheduler: summary オブジェクト
```

---

## モジュール対応表（Lambda 横断）

| モジュール | Handler | Weekly | Reminder | Kindle |
|------------|:-------:|:------:|:--------:|:------:|
| `drive.js` | ○ | — | — | ○ |
| `craft.js` | ○ | ○ | ○ | ○ |
| `line.js` | ○ | ○ | ○ | ○ |
| `transcribe/*` + `prompt.js` | ○ | — | — | — |
| `summarize.js` + `summary-prompt.js` | — | ○ | — | — |
| `kindle-summarize.js` + `kindle-prompt.js` | — | — | — | ○ |
