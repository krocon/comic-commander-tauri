import { book } from '../../../testing/fixtures';
import { filterKey, sortBooks } from './book-order';

const rels = (list: { relPath: string }[]) => list.map((b) => b.relPath);

describe('book-order', () => {
  it('natural order without case', () => {
    const sorted = sortBooks(
      ['Band 10.cbz', 'band 2.cbz', 'Band 1.cbz', 'a/Z.cbz'].map((p) => book(p)),
    );
    expect(rels(sorted)).toEqual(['a/Z.cbz', 'Band 1.cbz', 'band 2.cbz', 'Band 10.cbz']);
  });

  it('NFC and NFD sort together', () => {
    const nfd = 'Hügel 2.cbz';
    const sorted = sortBooks([book('Hz.cbz'), book(nfd), book('Hügel 1.cbz'), book('Ha.cbz')]);
    expect(rels(sorted)).toEqual(['Ha.cbz', 'Hügel 1.cbz', nfd, 'Hz.cbz']);
  });

  it('filter key is NFC and lower case', () => {
    expect(filterKey(book('HüGEL.cbz'))).toBe('hügel.cbz');
    expect(filterKey(book('HÜgel.cbz'))).toBe('hügel.cbz');
  });

  it('does not change the input', () => {
    const list = [book('b'), book('a')];
    sortBooks(list);
    expect(rels(list)).toEqual(['b', 'a']);
  });
});
