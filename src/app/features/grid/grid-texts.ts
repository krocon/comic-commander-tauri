/**
 * Texts of the cover grid (English = source; German follows in prompt 009).
 */
import { SortMode } from '../category/book-order';

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
    date: 'Newest first',
    size: 'Largest first',
  } satisfies Record<SortMode, string>,
  toTop: 'To the top',
  toBottom: 'To the bottom',
  noMatch: 'No book matches the filter.',
  focused: (name: string, pos: number, count: number) =>
    `${name}, ${pos.toLocaleString('en')} of ${count.toLocaleString('en')}`,
  bookMenu: (name: string) => `Actions for ${name}`,
  read: 'Read',
  readPdfLater: 'Read (PDF follows)',
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
