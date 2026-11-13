export interface KindleSummaryLink {
  folderName: string;
  appLink?: string;
}

export interface CsvImportFailure {
  fileName: string;
  reason: string;
}

export interface LineClient {
  push(text: string): Promise<void>;
}
