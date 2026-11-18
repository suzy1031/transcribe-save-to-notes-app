import type { DriveFile } from "../drive/types.ts";
import type { CsvImportFailure } from "../line/types.ts";
import type { BaseSettings } from "../shared/types.ts";

export interface FileLike {
  name?: string;
  mimeType?: string;
}

export interface CsvImportSettings extends BaseSettings {
  inboxFolderName: string;
  processedFolderName: string;
  spreadsheetId: string;
}

export interface CsvImportResult {
  imported: number;
  failed: number;
  failures: CsvImportFailure[];
  folderLookup?: string;
}

export interface MonthSums {
  total: number;
  debit: number;
  cash: number;
}

export interface ImportCsvFilesOptions {
  files: ReadonlyArray<DriveFile>;
  download: (file: DriveFile) => Promise<Uint8Array | Buffer>;
  existingSheetTitles: ReadonlyArray<string>;
  readSheet?: (title: string) => Promise<ReadonlyArray<ReadonlyArray<string>>>;
  writeSheet: (input: { title: string; rows: string[][] }) => Promise<void>;
  moveToProcessed: (file: DriveFile) => Promise<void>;
  pushLine: (text: string) => Promise<void>;
  spreadsheetUrl?: string;
  now?: Date;
}
