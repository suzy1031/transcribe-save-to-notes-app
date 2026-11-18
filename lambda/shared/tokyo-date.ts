import { TOKYO_TIME_ZONE } from "./const.ts";

/**
 * 指定されたタイムゾーンにおける日付を `YYYY-MM-DD` 形式で返す。
 * @param now 対象日時（デフォルトは現在時刻）
 * @param timeZone IANA タイムゾーン名（デフォルトは東京時間）
 * @returns `YYYY-MM-DD` 形式の日付文字列
 */
export function tokyoDate(now: Date = new Date(), timeZone: string = TOKYO_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
