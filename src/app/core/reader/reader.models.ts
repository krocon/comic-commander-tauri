import { FsError } from '../errors/fs-error';

/**
 * DTOs of the reader (design 005) – keep in sync with Rust `reader/model.rs` and
 * `reading_state.rs` (serde camelCase).
 */
export interface PageInfo {
  /** Name inside the book – display only. */
  name: string;
  size: number;
  /** Known in advance only for unpacked books; else from `dims` events or the loaded image. */
  width: number | null;
  height: number | null;
}

export interface OpenedBook {
  /** Names the open book in page URLs until `close` (E7). */
  token: string;
  /** Reading order (natural). */
  pages: PageInfo[];
  /** Remembered page (0-based), `null` = new book. */
  lastPage: number | null;
  /** Remembered rotation of the book in degrees clockwise: 0, 90, 180, 270 (design 014 E5). */
  rotation: number;
  /** 7z / solid RAR: unpacked into the app cache (E1). */
  extracting: boolean;
}

export interface PageDims {
  index: number;
  width: number;
  height: number;
}

export type ReaderEvent =
  { kind: 'dims'; pages: PageDims[] } | { kind: 'done' } | { kind: 'failed'; error: FsError };

export interface ReadingPosition {
  page: number;
  pages: number;
  updatedMs: number;
  /** Rotation of the book (design 014): 0, 90, 180, 270. */
  rotation: number;
}
