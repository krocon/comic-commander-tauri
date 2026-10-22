import { BookEntry, LibraryScan } from '../app/core/library/library.models';

export function book(relPath: string, overrides: Partial<BookEntry> = {}): BookEntry {
  const name = relPath.split('/').pop() ?? relPath; // test data only – never in app code
  return {
    path: `/lib/${relPath}`,
    relPath,
    name,
    format: 'cbz',
    size: 1000,
    modifiedMs: 0,
    ...overrides,
  };
}

export function libraryScan(root: string, relPaths: string[]): LibraryScan {
  return {
    root,
    books: relPaths.map((p) => book(p)),
    unreadableDirs: 0,
    skippedEntries: 0,
    truncated: false,
  };
}
