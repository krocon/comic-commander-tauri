import { BookEntry } from '../../core/scan/scan.models';
import { compareBooks, compareInSeries, SortMode } from '../category/book-order';
import { bookInfo } from './book-info';

/**
 * Views of the grid (design 011 E2): flat (as before), by series, by folder. A level of a
 * grouped view holds tiles: books and groups (a series, a folder). Pure.
 *
 * Folders are the `/` segments of `relPath` (display only, E6), compared in NFC – macOS keeps
 * names as written, NFC and NFD of one folder are one tile.
 */
export type ViewMode = 'flat' | 'series' | 'folders';
export const VIEW_MODES: readonly ViewMode[] = ['flat', 'series', 'folders'];

export interface BookItem {
  kind: 'book';
  /** = book id. */
  id: string;
  book: BookEntry;
}

export interface GroupItem {
  kind: 'group';
  group: 'series' | 'folder';
  /** `s:<series key>` / `d:<folder>` – never a book id (16 hex digits). */
  id: string;
  /** Series key or folder (NFC, segments joined with `/`) – the level it opens. */
  key: string;
  label: string;
  /** First book of the group (series: by number; folder: by path) – its cover. */
  cover: BookEntry;
  /** Books shown (after the filter) / all books of the group. */
  count: number;
  total: number;
  /** Books read to the end. */
  read: number;
  /** Mean part read of all books (unread = 0), `null` = none opened (E10). */
  progress: number | null;
  newestMs: number | null;
}

export type GridItem = BookItem | GroupItem;

/** Part read of a book (0…1) or `null` = never opened. */
export type ProgressOf = (book: BookEntry) => number | null;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function bookItems(books: readonly BookEntry[]): BookItem[] {
  return books.map((book) => ({ kind: 'book', id: book.id, book }));
}

function stats(all: readonly BookEntry[], progress: ProgressOf) {
  let read = 0;
  let sum = 0;
  let opened = false;
  let newest: number | null = null;
  for (const b of all) {
    const p = progress(b);
    if (p !== null) {
      opened = true;
      sum += Math.min(1, Math.max(0, p));
      if (p >= 1) read++;
    }
    if (b.modifiedMs !== null && (newest === null || b.modifiedMs > newest)) newest = b.modifiedMs;
  }
  return { read, progress: opened ? sum / all.length : null, newestMs: newest };
}

function orderItems(items: GridItem[], sort: SortMode): GridItem[] {
  const label = (i: GridItem) =>
    i.kind === 'group' ? i.label : (bookInfo(i.book).series ?? i.book.name);
  const newest = (i: GridItem) => (i.kind === 'group' ? i.newestMs : i.book.modifiedMs) ?? 0;
  return items.sort((a, b) =>
    sort === 'date'
      ? newest(b) - newest(a) || collator.compare(label(a), label(b))
      : collator.compare(label(a), label(b)) ||
        (a.kind === 'book' && b.kind === 'book' ? compareInSeries(a.book, b.book) : 0),
  );
}

/**
 * The top level of the series view: a tile per series with at least two books (E7), the other
 * books as books. `shown`: the filtered books; `all`: every book (totals, cover, progress).
 * Series without a shown book are left out.
 */
export function groupBySeries(
  all: readonly BookEntry[],
  shown: readonly BookEntry[],
  sort: SortMode,
  progress: ProgressOf,
): GridItem[] {
  const allByKey = new Map<string, BookEntry[]>();
  for (const b of all) {
    const k = bookInfo(b).seriesKey;
    if (k === null) continue;
    let l = allByKey.get(k);
    if (!l) allByKey.set(k, (l = []));
    l.push(b);
  }
  const shownCount = new Map<string, number>();
  const items: GridItem[] = [];
  for (const b of shown) {
    const k = bookInfo(b).seriesKey;
    const group = k === null ? undefined : allByKey.get(k);
    if (!group || group.length < 2) {
      items.push({ kind: 'book', id: b.id, book: b });
      continue;
    }
    shownCount.set(k!, (shownCount.get(k!) ?? 0) + 1);
  }
  for (const [k, count] of shownCount) {
    const group = [...allByKey.get(k)!].sort(compareInSeries);
    const cover = group[0];
    items.push({
      kind: 'group',
      group: 'series',
      id: `s:${k}`,
      key: k,
      label: bookInfo(cover).series ?? k,
      cover,
      count,
      total: group.length,
      ...stats(group, progress),
    });
  }
  return orderItems(items, sort);
}

/** The books of one series (filtered), in volume and number order (E9). */
export function seriesBooks(shown: readonly BookEntry[], key: string): BookEntry[] {
  return shown.filter((b) => bookInfo(b).seriesKey === key).sort(compareInSeries);
}

const nfcPaths = new WeakMap<BookEntry, string>();
function nfcPath(b: BookEntry): string {
  let p = nfcPaths.get(b);
  if (p === undefined) {
    p = b.relPath.normalize('NFC');
    nfcPaths.set(b, p);
  }
  return p;
}

/** Does `book` lie in `dir` (or below)? `dir` = '' is the top. */
export function inFolder(book: BookEntry, dir: string): boolean {
  return dir === '' || nfcPath(book).startsWith(dir + '/');
}

/**
 * One level of the folder view: a tile per sub folder (cover = first book of its subtree in path
 * order, counts of the subtree), then the books directly in `dir` in the order of `shown`.
 * Folders without a shown book are left out.
 */
export function folderLevel(
  all: readonly BookEntry[],
  shown: readonly BookEntry[],
  dir: string,
  progress: ProgressOf,
): GridItem[] {
  const prefix = dir === '' ? '' : dir + '/';
  const subOf = (b: BookEntry): string | null => {
    const p = nfcPath(b);
    if (!p.startsWith(prefix)) return null;
    const rest = p.substring(prefix.length);
    const slash = rest.indexOf('/');
    return slash < 0 ? '' : rest.substring(0, slash);
  };
  const folders = new Map<string, number>();
  const books: GridItem[] = [];
  for (const b of shown) {
    const sub = subOf(b);
    if (sub === null) continue;
    if (sub === '') books.push({ kind: 'book', id: b.id, book: b });
    else folders.set(sub, (folders.get(sub) ?? 0) + 1);
  }
  const subtree = new Map<string, BookEntry[]>();
  for (const b of all) {
    const sub = subOf(b);
    if (!sub || !folders.has(sub)) continue;
    let l = subtree.get(sub);
    if (!l) subtree.set(sub, (l = []));
    l.push(b);
  }
  const tiles: GroupItem[] = [...folders].map(([sub, count]) => {
    const group = subtree.get(sub)!;
    const key = prefix + sub;
    return {
      kind: 'group',
      group: 'folder',
      id: `d:${key}`,
      key,
      label: sub,
      cover: group.reduce((a, b) => (compareBooks(b, a) < 0 ? b : a)),
      count,
      total: group.length,
      ...stats(group, progress),
    };
  });
  tiles.sort((a, b) => collator.compare(a.label, b.label));
  return [...tiles, ...books];
}

/** Has any book the level? (A level whose books are all gone is left, design 011.) */
export function levelExists(all: readonly BookEntry[], view: ViewMode, level: string): boolean {
  if (view === 'series') return all.some((b) => bookInfo(b).seriesKey === level);
  if (view === 'folders') return level === '' || all.some((b) => inFolder(b, level));
  return true;
}

/** The level above (`null` = the top). */
export function parentLevel(view: ViewMode, level: string | null): string | null {
  if (level === null || view !== 'folders') return null;
  const slash = level.lastIndexOf('/');
  return slash < 0 ? null : level.substring(0, slash);
}

/** The tile id a level has one level up (the cursor goes back to it). */
export function levelTileId(view: ViewMode, level: string): string {
  return view === 'series' ? `s:${level}` : `d:${level}`;
}

export interface Crumb {
  label: string;
  /** `null` = the top. */
  level: string | null;
}

/** The way to the level: the top, then the series or every folder on the way. */
export function breadcrumb(
  view: ViewMode,
  level: string | null,
  top: string,
  seriesLabel: (key: string) => string,
): Crumb[] {
  if (view === 'flat' || level === null) return [];
  const crumbs: Crumb[] = [{ label: top, level: null }];
  if (view === 'series') {
    crumbs.push({ label: seriesLabel(level), level });
  } else {
    const parts = level.split('/');
    parts.forEach((p, i) => crumbs.push({ label: p, level: parts.slice(0, i + 1).join('/') }));
  }
  return crumbs;
}
