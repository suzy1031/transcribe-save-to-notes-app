const SUMMARY_PROMPT = `あなたは優秀なナレッジマネージャーです。
以下のテキストは、今週1週間でCraftの「daily_note_transcribe」フォルダに記録されたノートの集約データです。

以下のフォーマットで週次サマリーを作成してください：

【週次Craftノートまとめ】

📌 今週のハイライト
（3〜5行で簡潔に）

📝 主なトピック
（箇条書き）

🚀 来週への持ち越し・アクションアイテム
- [ ] ToDo形式で記載してください
`;

export function combineNotes(notes) {
  return notes.map((note) => `# ${note.title}\n\n${note.markdown}`.trim()).join("\n\n");
}

export function summaryPrompt(notesText) {
  const notes = String(notesText ?? "").trim();
  if (notes === "") return SUMMARY_PROMPT;
  return `${SUMMARY_PROMPT}\n\n---\n${notes}`;
}
