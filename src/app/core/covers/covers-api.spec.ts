import { book } from '../../../testing/fixtures';
import { coverPath, coverVersion } from './covers-api';

describe('cover URLs', () => {
  it('use ids only, never the path', () => {
    const b = book('Hägar/Hägar 01 🦸.cbz', { id: '0123456789abcdef', modifiedMs: 1729600000000 });
    expect(coverPath('c0123456789ab', b, 1)).toBe('c0123456789ab.0123456789abcdef.1');
    expect(coverPath('c0123456789ab', b, 1)).not.toContain('Hägar');
    expect(coverVersion(b)).toBe('?v=1729600000000');
    expect(coverVersion({ ...b, modifiedMs: null })).toBe('?v=0');
  });

  it('survives encodeURIComponent unchanged (convertFileSrc encodes the path)', () => {
    const p = coverPath('c0123456789ab', book('a.cbz', { id: 'ffffffffffffffff' }), 0);
    expect(encodeURIComponent(p)).toBe(p);
  });
});
