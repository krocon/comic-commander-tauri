import { FsError, FsErrorCode } from '../errors/fs-error';

/** DTOs of the jobs (design 007) – keep in sync with Rust `jobs/thumbs.rs` (serde camelCase). */
export interface ReadyBook {
  categoryId: string;
  bookId: string;
}

export interface ThumbsProgress {
  total: number;
  processed: number;
  generated: number;
  /** No image in the book. */
  skipped: number;
  errors: number;
  /** `relPath` of the book in work. */
  currentFile: string | null;
  /** Working time, pauses not counted. */
  elapsedMs: number;
  paused: boolean;
  /** Finished since the last event (the grid draws them again). */
  ready: ReadyBook[];
}

export interface ThumbError {
  name: string;
  code: FsErrorCode;
}

export type JobEvent =
  | { kind: 'counting'; found: number; existing: number }
  | { kind: 'progress'; progress: ThumbsProgress }
  | { kind: 'done'; progress: ThumbsProgress; cancelled: boolean; errorList: ThumbError[] }
  | { kind: 'failed'; error: FsError };
