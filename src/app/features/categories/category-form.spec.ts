// @ts-expect-error – node built-in, available in the Vitest runner
import { readFileSync } from 'node:fs';
import {
  DEFAULT_EXTENSIONS,
  ICONS,
  SUPPORTED_EXTENSIONS,
  move,
  newCategory,
  sameTarget,
  validateCategory,
} from './category-form';

/** The string literals of a `pub const NAME: &[&str] = &[ … ];` in the Rust source. */
function rustList(src: string, name: string): string[] {
  const m = new RegExp(`pub const ${name}: &\\[&str\\] = &\\[([\\s\\S]*?)\\];`).exec(src);
  if (!m) throw new Error(`${name} not found`);
  return [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
}

describe('category-form', () => {
  it('lists match Rust categories.rs', () => {
    const src: string = readFileSync('src-tauri/src/categories.rs', 'utf8');
    expect([...SUPPORTED_EXTENSIONS]).toEqual(rustList(src, 'SUPPORTED_EXTENSIONS'));
    expect(DEFAULT_EXTENSIONS).toEqual(rustList(src, 'DEFAULT_EXTENSIONS'));
    expect(ICONS).toEqual(rustList(src, 'ICONS'));
  });

  it('a new category is valid once it has a folder', () => {
    expect(validateCategory(newCategory()).map((p) => p.code)).toEqual(['base_dir_missing']);
    expect(validateCategory(newCategory('/comics'))).toEqual([]);
  });

  it('finds the problems the backend would refuse', () => {
    const c = {
      ...newCategory('/x'),
      bookExtensions: [],
      thumbsDims: [
        { width: 10, height: 300, nameExtension: '' },
        { width: 200, height: 300, nameExtension: '../x' },
        { width: 200.5, height: 300, nameExtension: '' },
      ],
    };
    expect(validateCategory(c)).toEqual([
      { field: 'bookExtensions', code: 'no_extension' },
      { field: 'thumbsDims', code: 'size_out_of_range', index: 0 },
      { field: 'thumbsDims', code: 'bad_suffix', index: 1 },
      { field: 'thumbsDims', code: 'size_out_of_range', index: 2 },
    ]);
    expect(validateCategory({ ...newCategory('/x'), thumbsDims: [] })[0].code).toBe('no_size');
  });

  it('sameTarget ignores the order of extensions', () => {
    const a = { ...newCategory('/x'), bookExtensions: ['.cbz', '.cbr'] };
    expect(sameTarget(a, { ...a, bookExtensions: ['.cbr', '.cbz'] })).toBe(true);
    expect(sameTarget(a, { ...a, bookExtensions: ['.cbz'] })).toBe(false);
    expect(sameTarget(a, { ...a, baseDir: '/y' })).toBe(false);
  });

  it('move', () => {
    expect(move(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(move(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b']);
    expect(move(['a'], 0, 5)).toEqual(['a']);
  });
});
