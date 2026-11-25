export const TOKYO_TIME_ZONE = "Asia/Tokyo";
export const DEFAULT_AWS_REGION = "ap-northeast-1";

export const INBOX_FOLDER_NAME = "00_notes_inbox";
export const PROCESSED_DRIVE_FOLDER_NAME = "01_processed";

export const DEFAULT_OBSIDIAN_VAULT_NAME = "ks-vault";
export const DEFAULT_OBSIDIAN_DAILY_FOLDER = "00_daily_notes";
export const DEFAULT_OBSIDIAN_SUMMARY_FOLDER = "daily_note_summaries";
export const DEFAULT_OBSIDIAN_KINDLE_FOLDER = "kindle";
export const DEFAULT_OBSIDIAN_HOUSEHOLD_BUDGET_FOLDER = "household_budget";

export const DEFAULT_KINDLE_DRIVE_PARENT = "kindle";
export const DEFAULT_KINDLE_BOOK_PREFIX = "kindle_";
export const DEFAULT_KINDLE_PROCESSED_FOLDER = "processed";

export const DEFAULT_CSV_INBOX_FOLDER = "csv_inbox";
export const DEFAULT_CSV_PROCESSED_FOLDER = "csv_processed";

export const ALL_NOTES_SINCE = "1970-01-01";
export const MIN_REMAINING_MS = 60_000;
export const REMINDER_LOOKBACK_DAYS = 7;
export const WEEKLY_LOOKBACK_DAYS = 7;

export const DEFAULT_TRANSCRIPTION_PROVIDER = "claude";
export const DEFAULT_BEDROCK_MODEL_ID = "amazon.nova-lite-v1:0";
export const DEFAULT_CLAUDE_TRANSCRIBE_MODEL_ID = "claude-sonnet-5-5";
export const DEFAULT_CLAUDE_WEEKLY_MODEL_ID = "claude-haiku-5-5";

export const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
export const ANTHROPIC_API_VERSION = "2023-06-01";
export const ANTHROPIC_MCP_BETA_HEADER = "mcp-client-2025-11-20";
export const DEFAULT_MCP_DOMAIN_NAME = "infra-practice.jp";
export const JSON_CONTENT_TYPE = "application/json";
export const IMAGE_MIME_JPEG = "image/jpeg";
export const IMAGE_MIME_PNG = "image/png";

export const MAX_TRANSCRIPTION_TOKENS = 4096;
export const MAX_SUMMARY_TOKENS = 2048;
export const MAX_IMAGE_BYTES = 7 * 1024 * 1024;

/** Per-request timeout for Craft, LINE, Anthropic, and Google Drive HTTP calls. */
export const EXTERNAL_API_FETCH_TIMEOUT_MS = 30_000;
export const CLAUDE_MCP_FETCH_TIMEOUT_MS = 120_000;

export const TRANSCRIBE_USER_PROMPT = "この手書きノート画像を読み取ってください。";
