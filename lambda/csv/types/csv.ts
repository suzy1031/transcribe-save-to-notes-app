import type { CsvImportFailure } from "../../line/types/line.ts";
import type { BaseSettings } from "../../shared/types/settings.ts";

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
