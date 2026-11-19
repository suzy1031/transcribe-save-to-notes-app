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
  householdBudgetFolder: string;
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
  existingNoteTitles: ReadonlyArray<string>;
  readNoteRows?: (title: string) => Promise<ReadonlyArray<ReadonlyArray<string>>>;
  writeNote: (input: { title: string; date: string; markdown: string }) => Promise<string>;
  moveToProcessed: (file: DriveFile) => Promise<void>;
  pushLine: (text: string) => Promise<void>;
  buildNoteLink?: (noteKey: string) => string;
  now?: Date;
}
