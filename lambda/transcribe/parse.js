export function parseTranscription(text) {
  const stripped = String(text)
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed = JSON.parse(stripped);
  if (typeof parsed.title !== "string" || parsed.title.trim() === "") {
    throw new Error("Transcription JSON is missing title");
  }
  if (typeof parsed.markdown !== "string") {
    throw new Error("Transcription JSON is missing markdown");
  }
  return { title: parsed.title.trim(), markdown: parsed.markdown };
}

export function assertImageSize(bytes, maxImageBytes) {
  if (bytes.byteLength > maxImageBytes) {
    const error = new Error("Image exceeds the size limit");
    error.code = "IMAGE_TOO_LARGE";
    throw error;
  }
}
