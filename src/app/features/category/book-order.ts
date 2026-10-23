import { BookEntry } from '../../core/scan/scan.models';
import { bookInfo } from '../grid/book-info';

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

/**
 * Orders of the grid (design 004 E4). `path`: folder and name (default), `name`: file name,
 * `series`: series → volume → number (design 011 E9).
 */
export type SortMode = 'path' | 'name' | 'series' | 'date' | 'size';
export const SORT_MODES: readonly SortMode[] = ['path', 'name', 'series', 'date', 'size'];

function compareNames(a: BookEntry, b: BookEntry): number {
  return collator.compare(a.name, b.name) || compareBooks(a, b);
}

/** Within one series: volume, number (as value, then as written); missing ones last. */
export function compareInSeries(a: BookEntry, b: BookEntry): number {
  const x = bookInfo(a);
  const y = bookInfo(b);
  const byNull = (p: number | null, q: number | null) =>
    p === q ? 0 : p === null ? 1 : q === null ? -1 : p - q;
  return (
    byNull(x.volume, y.volume) ||
    byNull(x.numberValue, y.numberValue) ||
    collator.compare(x.number ?? '', y.number ?? '') ||
    compareBooks(a, b)
  );
}

/** Series (books without one by their name), then `compareInSeries`. */
export function compareSeries(a: BookEntry, b: BookEntry): number {
  const ka = bookInfo(a).seriesKey ?? a.name.normalize('NFC').toLowerCase();
  const kb = bookInfo(b).seriesKey ?? b.name.normalize('NFC').toLowerCase();
  return collator.compare(ka, kb) || compareInSeries(a, b);
}

/** Newest / largest first; equal ones in path order. */
export function sortBooksBy(books: readonly BookEntry[], mode: SortMode): BookEntry[] {
  const list = [...books];
  switch (mode) {
    case 'path':
      return list.sort(compareBooks);
    case 'name':
      return list.sort(compareNames);
    case 'series':
      return list.sort(compareSeries);
    case 'date':
      return list.sort((a, b) => (b.modifiedMs ?? 0) - (a.modifiedMs ?? 0) || compareBooks(a, b));
    case 'size':
      return list.sort((a, b) => b.size - a.size || compareBooks(a, b));
  }
}
