export interface SheetsClient {
  listSheetTitles(spreadsheetId: string): Promise<string[]>;
  getSheetValues(spreadsheetId: string, title: string): Promise<string[][]>;
  addSheetWithValues(input: {
    spreadsheetId: string;
    title: string;
    rows: ReadonlyArray<ReadonlyArray<string>>;
  }): Promise<void>;
}
