/**
 * DTOs of a scan – mirror of Rust `model.rs` and `scan_hub.rs` (keep in sync by hand, both
 * sides + test). Paths are opaque strings: never split or joined in the frontend.
 */
import { FsError } from '../errors/fs-error';

/** Container kind by extension (`.zip` → `cbz` …, design 002 E3). */
export type BookFormat = 'cbz' | 'cbr' | 'cb7' | 'cbt' | 'pdf';

/** `ComicInfo.xml` of a book (design 011) – mirror of Rust `comic_info::BookMeta`. */
export interface BookMeta {
  series?: string;
  /** As written (`1`, `01`, `1.5`, `12a`). */
  number?: string;
  volume?: number;
  title?: string;
  year?: number;
  writer?: string;
  publisher?: string;
  pageCount?: number;
  /** `rtl` = `YesAndRightToLeft`. */
  manga?: 'no' | 'yes' | 'rtl';
}

export interface BookEntry {
  /** `fnv64(path)` as 16 hex digits – addresses the book in cover URLs (design 003 E1). */
  id: string;
  /** Full path (opaque). */
  path: string;
  /** Below the category's `baseDir`, segments joined with `/` – display, filter, sort only. */
  relPath: string;
  name: string;
  format: BookFormat;
  size: number;
  modifiedMs: number | null;
  /** ComicInfo (design 011): missing = not read yet, `{}` = read, nothing found. */
  meta?: BookMeta;
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
  /** The cached books, in parts of ≤ 2000 (design 004): `complete` = no `cachedMore` follows. */
  | { kind: 'cached'; books: BookEntry[]; scannedAt: number; stats: ScanStats; complete: boolean }
  | { kind: 'cachedMore'; books: BookEntry[]; complete: boolean }
  | { kind: 'started'; firstScan: boolean }
  | { kind: 'batch'; books: BookEntry[] }
  | { kind: 'progress'; books: number; dirs: number }
  | { kind: 'diff'; added: BookEntry[]; removed: string[]; changed: BookEntry[] }
  | { kind: 'done'; scannedAt: number; stats: ScanStats }
  | { kind: 'cancelled' }
  | { kind: 'failed'; error: FsError; cacheKept: boolean }
  /** ComicInfo pass after `done` (design 011 E3). */
  | { kind: 'metaProgress'; done: number; total: number }
  | { kind: 'meta'; items: { id: string; meta: BookMeta }[] }
  | { kind: 'metaDone'; cancelled: boolean };
