import { BookEntry, ScanStats } from '../app/core/scan/scan.models';
import { CategoriesConfig, Category } from '../app/core/categories/categories.models';

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

export function books(...relPaths: string[]): BookEntry[] {
  return relPaths.map((p) => book(p));
}

export function stats(overrides: Partial<ScanStats> = {}): ScanStats {
  return {
    books: 0,
    dirs: 1,
    unreadableDirs: 0,
    skippedEntries: 0,
    skippedDirLinks: 0,
    brokenLinks: 0,
    truncated: false,
    durationMs: 1,
    ...overrides,
  };
}

export function category(id: string, overrides: Partial<Category> = {}): Category {
  return {
    id,
    title: `Title ${id}`,
    baseDir: `/comics/${id}`,
    bookExtensions: ['.cbz', '.cbr'],
    icon: 'star',
    thumbsDims: [
      { width: 200, height: 300, nameExtension: '' },
      { width: 800, height: 1200, nameExtension: '_xl' },
    ],
    dimIndex: 1,
    initialFilter: '',
    ...overrides,
  };
}

export function config(categories: Category[], activeId?: string | null): CategoriesConfig {
  return {
    version: 1,
    activeId: activeId === undefined ? (categories[0]?.id ?? null) : activeId,
    categories,
  };
}
