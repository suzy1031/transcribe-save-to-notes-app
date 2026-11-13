export interface ProcessInboxSummary {
  processed: number;
  failed: number;
  skipped: number;
  deferred: number;
  folderLookup?: string;
}
