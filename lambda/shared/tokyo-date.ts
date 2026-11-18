import { TOKYO_TIME_ZONE, WEEKLY_LOOKBACK_DAYS } from "./const.ts";

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

/**
 * 指定されたタイムゾーンにおける日付から指定日数前の日付を `YYYY-MM-DD` 形式で返す。
 * @param now 対象日時（デフォルトは現在時刻）
 * @param days 遡る日数（デフォルトは週次集計期間の7日）
 * @param timeZone IANA タイムゾーン名（デフォルトは東京時間）
 * @returns `YYYY-MM-DD` 形式の日付文字列
 */
export function daysBeforeTokyoDate(
  now: Date = new Date(),
  days: number = WEEKLY_LOOKBACK_DAYS,
  timeZone: string = TOKYO_TIME_ZONE,
): string {
  const [year, month, day] = tokyoDate(now, timeZone).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
