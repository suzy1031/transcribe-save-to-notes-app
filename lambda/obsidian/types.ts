export interface ObsidianListedNote {
  id: string;
  key: string;
  title: string;
  createdDate: string;
}

export interface ListNotesParams {
  folder: string;
  createdDateGte?: string;
  createdDateLte?: string;
}

export interface SaveNoteInput {
  folder: string;
  title: string;
  markdown: string;
  date?: string;
  tags?: ReadonlyArray<string>;
}

export interface S3ObjectSummary {
  Key?: string;
  LastModified?: Date;
}

export interface S3ClientLike {
  send(command: unknown): Promise<any>;
}

export interface CreateObsidianClientOptions {
  bucketName: string;
  region?: string;
  s3Client?: S3ClientLike;
}

export interface ObsidianClient {
  saveOrAppendNote(input: SaveNoteInput): Promise<string>;
  createNote(input: SaveNoteInput): Promise<string>;
  listNotes(params: ListNotesParams): Promise<ObsidianListedNote[]>;
  readMarkdown(key: string): Promise<string>;
}
