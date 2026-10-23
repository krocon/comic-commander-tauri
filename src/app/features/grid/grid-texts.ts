/**
 * Texts of the cover grid (English = source; German follows in prompt 009).
 */
import { SortMode } from '../category/book-order';
import type { ViewMode } from './grouping';

export const GRID_TEXTS = {
  gridLabel: 'Comic books',
  filter: 'Filter',
  filterPlaceholder: 'Filter  (+must  -not)',
  filterCount: (shown: number, total: number) =>
    `${shown.toLocaleString('en')} / ${total.toLocaleString('en')}`,
  clearFilter: 'Clear filter',
  thumbSize: 'Thumb size',
  sort: 'Order',
  sortModes: {
    path: 'Folder and name',
    name: 'File name',
    series: 'Series and number',
    date: 'Newest first',
    size: 'Largest first',
  } satisfies Record<SortMode, string>,
  /** Design 011: views, levels, groups. */
  views: { flat: 'All books', series: 'Series', folders: 'Folders' } satisfies Record<
    ViewMode,
    string
  >,
  viewLabel: 'View',
  topOf: { flat: '', series: 'All series', folders: 'All folders' } satisfies Record<
    ViewMode,
    string
  >,
  levelNav: 'Level',
  groupLabel: (
    kind: 'series' | 'folder',
    name: string,
    count: number,
    total: number,
    read: number,
  ) =>
    `${kind === 'series' ? 'Series' : 'Folder'} ${name}, ${
      count === total
        ? total.toLocaleString('en')
        : `${count.toLocaleString('en')} of ${total.toLocaleString('en')}`
    } ${kind === 'series' ? (total === 1 ? 'volume' : 'volumes') : total === 1 ? 'book' : 'books'}${
      read ? `, ${read.toLocaleString('en')} read` : ''
    }`,
  groupMenu: (name: string) => `Actions for ${name}`,
  openGroup: 'Open',
  readGroup: 'Read first unread',
  bookTitle: (relPath: string, line: string | null) => (line ? `${relPath}\n${line}` : relPath),
  sourceOf: { comicinfo: 'ComicInfo', name: 'name', folder: 'folder' } as const,
  toTop: 'To the top',
  toBottom: 'To the bottom',
  noMatch: 'No book matches the filter.',
  focused: (name: string, pos: number, count: number) =>
    `${name}, ${pos.toLocaleString('en')} of ${count.toLocaleString('en')}`,
  bookMenu: (name: string) => `Actions for ${name}`,
  read: 'Read',
  openExternal: 'Open with default app',
  reveal: revealText(),
  filterSeries: 'Filter series',
  copyPath: 'Copy path',
  copied: 'Path copied.',
};

function revealText(): string {
  const p = typeof navigator === 'undefined' ? '' : navigator.platform;
  if (p.startsWith('Mac')) return 'Show in Finder';
  if (p.startsWith('Win')) return 'Show in Explorer';
  return 'Show in file manager';
}
