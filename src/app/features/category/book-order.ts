import { BookEntry } from '../../core/scan/scan.models';

/**
 * Display order and filter keys of books (design 002 E6). Natural (`2` < `10`), without case,
 * and NFC = NFD – macOS keeps names as written, Marc's collection mixes both forms. Text
 * operations on `relPath` only; paths are never split here.
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function compareBooks(a: BookEntry, b: BookEntry): number {
  const c = collator.compare(a.relPath, b.relPath);
  if (c !== 0) return c;
  // equal for humans (e.g. NFC vs. NFD): still a stable, total order
  return a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0;
}

export function sortBooks(books: readonly BookEntry[]): BookEntry[] {
  return [...books].sort(compareBooks);
}

/** Key for the filter of prompt 004: NFC, lower case. */
export function filterKey(book: BookEntry): string {
  return book.relPath.normalize('NFC').toLowerCase();
}
