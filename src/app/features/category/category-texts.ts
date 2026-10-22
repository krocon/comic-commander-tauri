/**
 * Texts of the category view (English = source; German follows in prompt 009).
 */
const count = (n: number, one: string, many: string) =>
  n === 1 ? `1 ${one}` : `${n.toLocaleString('en')} ${many}`;

/** „just now“, „3 min ago“, „2 h ago“, else date + time. */
export function relativeTime(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `on ${dateTime(ms)}`;
}

export function dateTime(ms: number): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(ms);
}

export const CATEGORY_TEXTS = {
  menuLabel: 'Category',
  noCategory: 'No category',
  manage: 'Manage categories…',
  importOld: 'Import old config…',
  rescan: 'Scan again',
  cancel: 'Cancel',
  listLabel: 'Comic books',
  books: (n: number) => count(n, 'book', 'books'),
  updated: (ms: number, now: number) => `updated ${relativeTime(ms, now)}`,
  refreshing: 'refreshing…',
  scanning: (books: number, dirs: number) =>
    `Scanning… ${count(books, 'book', 'books')} in ${count(dirs, 'folder', 'folders')}`,
  cancelled: (n: number) => `Scan cancelled – ${count(n, 'book', 'books')} found so far`,
  unreachable: (ms: number) => `Folder not reachable – showing the state of ${dateTime(ms)}`,
  skippedDirLinks: (n: number) => count(n, 'linked folder', 'linked folders') + ' skipped',
  unreadableDirs: (n: number) => count(n, 'folder', 'folders') + ' unreadable',
  truncated: 'Too many books – the list stops at 500,000.',
  noBooks: (exts: string[]) => `No books of the types ${exts.join(' ')} in this folder.`,
  more: (n: number) =>
    `… and ${n.toLocaleString('en')} more – the cover grid follows in prompt 004.`,
  firstStartTitle: 'No category yet',
  firstStartText:
    'A category is a folder with comics; it is scanned with all subfolders. You can add several.',
  createCategory: 'Create category…',
  useComics: (dir: string) => `Use ${dir}`,
  editCategory: 'Edit category…',
  configBroken: 'The categories file was broken and has been set aside.',
};
