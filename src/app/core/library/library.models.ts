/**
 * DTOs of the library – mirror of Rust `model.rs` (keep in sync by hand, both sides + test).
 * Paths are opaque strings: never split or joined in the frontend.
 */
export type BookFormat = 'cbz' | 'cbr' | 'cb7' | 'cbt' | 'pdf';

export interface BookEntry {
  /** Full path (opaque). */
  path: string;
  /** Below the library root, segments joined with `/` – display, filter and sort only. */
  relPath: string;
  name: string;
  format: BookFormat;
  size: number;
  modifiedMs: number | null;
}

export interface LibraryScan {
  root: string;
  /** Natural order of `relPath`. */
  books: BookEntry[];
  unreadableDirs: number;
  skippedEntries: number;
  truncated: boolean;
}
