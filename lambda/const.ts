export const TOKYO_TIME_ZONE = "Asia/Tokyo";
export const DEFAULT_AWS_REGION = "ap-northeast-1";

export const INBOX_FOLDER_NAME = "00_notes_inbox";
export const PROCESSED_DRIVE_FOLDER_NAME = "01_processed";

export const DEFAULT_CRAFT_TRANSCRIBE_FOLDER = "daily_note_transcribe";
export const DEFAULT_CRAFT_PROCESSED_FOLDER = "processed";
export const DEFAULT_CRAFT_SUMMARY_FOLDER = "daily_note_summaries";

export const DEFAULT_KINDLE_DRIVE_PARENT = "kindle";
export const DEFAULT_KINDLE_BOOK_PREFIX = "kindle_";
export const DEFAULT_KINDLE_PROCESSED_FOLDER = "processed";
export const DEFAULT_KINDLE_SUMMARY_DOC_TITLE = "要約";

export const DEFAULT_CSV_INBOX_FOLDER = "csv_inbox";
export const DEFAULT_CSV_PROCESSED_FOLDER = "csv_processed";
export const DEFAULT_CSV_SPREADSHEET_ID = "1nKB9S7EHVue05Kcwb3F_VGVOHHuYBJ1F84-pUwQCHNU";

export const ALL_CRAFT_DOCUMENTS_SINCE = "1970-01-01";
export const MIN_REMAINING_MS = 60_000;
export const REMINDER_LOOKBACK_DAYS = 7;
export const WEEKLY_LOOKBACK_DAYS = 7;

export const DEFAULT_TRANSCRIPTION_PROVIDER = "claude";
export const DEFAULT_BEDROCK_MODEL_ID = "amazon.nova-lite-v1:0";
export const DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID = "claude-sonnet-5-5";
export const DEFAULT_CLAUDE_WEEKLY_MODEL_ID = "claude-haiku-5-5";

export const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_API_VERSION = "2023-06-01";
export const JSON_CONTENT_TYPE = "application/json";

export const MAX_TRANSCRIPTION_TOKENS = 4096;
export const MAX_SUMMARY_TOKENS = 2048;
export const MAX_IMAGE_BYTES = 7 * 1024 * 1024;

/** Per-request timeout for Craft, LINE, Anthropic, and Google Drive HTTP calls. */
export const EXTERNAL_API_FETCH_TIMEOUT_MS = 30_000;

export const TRANSCRIBE_USER_PROMPT = "この手書きノート画像を読み取ってください。";
