import { Category, ThumbsDim } from '../../core/categories/categories.models';

/**
 * Pure helpers of the category form (design 002). The lists mirror Rust `categories.rs` –
 * `category-form.spec.ts` compares them with the Rust source.
 */
export const SUPPORTED_EXTENSIONS = [
  '.cbz',
  '.cbr',
  '.cb7',
  '.cbt',
  '.pdf',
  '.zip',
  '.rar',
  '.7z',
  '.tar',
] as const;

export const DEFAULT_EXTENSIONS = ['.cbz', '.cbr', '.cb7', '.cbt', '.pdf'];

export const ICONS = [
  'book',
  'star',
  'bookmark',
  'rocket',
  'flag',
  'heart',
  'fire',
  'bolt',
  'globe',
  'university',
  'child',
  'user-secret',
  'paw',
  'magic',
  'diamond',
  'trophy',
  'film',
  'camera',
  'music',
  'car',
  'plane',
  'ship',
  'tree',
  'moon-o',
];

export const MIN_PX = 32;
export const MAX_PX = 2000;
export const MAX_DIMS = 5;
export const MAX_SUFFIX_CHARS = 20;

export function defaultThumbsDims(): ThumbsDim[] {
  return [
    { width: 200, height: 300, nameExtension: '' },
    { width: 800, height: 1200, nameExtension: '_xl' },
  ];
}

/** A new, unsaved category (id and title are filled in by the backend). */
export function newCategory(baseDir = ''): Category {
  return {
    id: '',
    title: '',
    baseDir,
    bookExtensions: [...DEFAULT_EXTENSIONS],
    icon: 'book',
    thumbsDims: defaultThumbsDims(),
    dimIndex: 0,
    initialFilter: '',
  };
}

export type ProblemCode =
  | 'base_dir_missing'
  | 'no_extension'
  | 'no_size'
  | 'too_many_sizes'
  | 'size_out_of_range'
  | 'bad_suffix';

export interface Problem {
  field: 'baseDir' | 'bookExtensions' | 'thumbsDims';
  code: ProblemCode;
  /** Index of the size for size problems. */
  index?: number;
}

export function isValidSuffix(s: string): boolean {
  // eslint-disable-next-line no-control-regex
  return [...s].length <= MAX_SUFFIX_CHARS && !/[/\\:\u0000-\u001f\u007f]/.test(s);
}

/** What the backend would refuse – checked live in the dialog (Rust checks again). */
export function validateCategory(c: Category): Problem[] {
  const problems: Problem[] = [];
  if (!c.baseDir.trim()) problems.push({ field: 'baseDir', code: 'base_dir_missing' });
  if (c.bookExtensions.length === 0)
    problems.push({ field: 'bookExtensions', code: 'no_extension' });
  if (c.thumbsDims.length === 0) problems.push({ field: 'thumbsDims', code: 'no_size' });
  if (c.thumbsDims.length > MAX_DIMS)
    problems.push({ field: 'thumbsDims', code: 'too_many_sizes' });
  c.thumbsDims.forEach((d, index) => {
    const ok = (n: number) => Number.isInteger(n) && n >= MIN_PX && n <= MAX_PX;
    if (!ok(d.width) || !ok(d.height)) {
      problems.push({ field: 'thumbsDims', code: 'size_out_of_range', index });
    }
    if (!isValidSuffix(d.nameExtension)) {
      problems.push({ field: 'thumbsDims', code: 'bad_suffix', index });
    }
  });
  return problems;
}

/** Same folder and the same set of extensions (the backend's cache key). */
export function sameTarget(a: Category, b: Category): boolean {
  const set = (c: Category) => [...c.bookExtensions].sort().join('\u0000');
  return a.baseDir === b.baseDir && set(a) === set(b);
}

/** Moves item `from` to `to` (returns a new array). */
export function move<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return [...list];
  }
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}
