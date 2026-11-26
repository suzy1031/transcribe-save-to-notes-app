export const SHEET_TITLE_PATTERN = /^(\d{4}-\d{2}-\d{2})_(.+)$/;

export const AMOUNT_PATTERN = /^-?\d+(\.\d+)?$/;
export const DEBIT_CATEGORY = "デビット支払い";
export const DEBIT_TOTAL_LABEL = "デビット支払い合計";
export const DEBIT_AMOUNT_COLUMN_INDEX = 0;
export const DEBIT_CATEGORY_COLUMN_INDEX = 3;

export const CASH_CATEGORIES = new Set(["現金", "現金支払い"]);
export const CASH_TOTAL_LABEL = "現金支払い";
export const CASH_AMOUNT_COLUMN_INDEX = 0;
export const CASH_CATEGORY_COLUMN_INDEX = 2;
export const CASH_TOTAL_LABEL_COLUMN_INDEX = 3;

export const CUMULATIVE_TOTAL_LABEL = "累計 合計";
export const CUMULATIVE_DEBIT_LABEL = "デビット 合計";
export const CUMULATIVE_CASH_LABEL = "現金 合計";

export const DATE_HEADER = "日付";
export const DATE_PATTERN = /^(\d{4})([-/])(\d{2})\2(\d{2})$/;
