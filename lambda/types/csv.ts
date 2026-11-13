import type { CsvImportFailure } from "./line.ts";

export interface FileLike {
  name?: string;
  mimeType?: string;
}

export interface CsvImportResult {
  imported: number;
  failed: number;
  failures: CsvImportFailure[];
  folderLookup?: string;
}
