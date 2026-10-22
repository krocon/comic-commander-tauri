/**
 * DTOs of a scan – mirror of Rust `model.rs` and `scan_hub.rs` (keep in sync by hand, both
 * sides + test). Paths are opaque strings: never split or joined in the frontend.
 */
import { FsError } from '../errors/fs-error';

/** Container kind by extension (`.zip` → `cbz` …, design 002 E3). */
export type BookFormat = 'cbz' | 'cbr' | 'cb7' | 'cbt' | 'pdf';

export interface BookEntry {
  /** Full path (opaque). */
  path: string;
  /** Below the category's `baseDir`, segments joined with `/` – display, filter, sort only. */
  relPath: string;
  name: string;
  format: BookFormat;
  size: number;
  modifiedMs: number | null;
}

export interface ScanStats {
  books: number;
  dirs: number;
  unreadableDirs: number;
  skippedEntries: number;
  skippedDirLinks: number;
  brokenLinks: number;
  truncated: boolean;
  durationMs: number;
}

/** Events of `open_category` (design 002 E9). */
export type ScanEvent =
  | { kind: 'cached'; books: BookEntry[]; scannedAt: number; stats: ScanStats }
  | { kind: 'started'; firstScan: boolean }
  | { kind: 'batch'; books: BookEntry[] }
  | { kind: 'progress'; books: number; dirs: number }
  | { kind: 'diff'; added: BookEntry[]; removed: string[]; changed: BookEntry[] }
  | { kind: 'done'; scannedAt: number; stats: ScanStats }
  | { kind: 'cancelled' }
  | { kind: 'failed'; error: FsError; cacheKept: boolean };
