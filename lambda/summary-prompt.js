const SUMMARY_PROMPT = `あなたは優秀なナレッジマネージャーです。
以下のテキストは、今週1週間でCraftの「daily_note_transcribe」フォルダに記録されたノートの集約データです。

LINEメッセージとして読みやすいよう、絵文字や改行を活用して以下のフォーマットで週次サマリーを作成してください：

【週次Craftノートまとめ】

📌 今週のハイライト
（3〜5行で簡潔に）

📝 主なトピックと決定事項
（箇条書き）

🚀 来週への持ち越し・アクションアイテム
（ToDo形式）

---
【ノートデータ】
{統合されたCraftノートテキスト}`;

export function combineNotes(notes) {
  return notes.map((note) => `# ${note.title}\n\n${note.markdown}`.trim()).join("\n\n");
}

export function summaryPrompt(notesText) {
  return SUMMARY_PROMPT.replace("{統合されたCraftノートテキスト}", notesText);
}
