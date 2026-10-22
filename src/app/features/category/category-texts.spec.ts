import { CATEGORY_TEXTS, relativeTime } from './category-texts';

describe('category texts', () => {
  const now = Date.UTC(2026, 9, 22, 15, 0, 0);
  it('relative time', () => {
    expect(relativeTime(now - 5_000, now)).toBe('just now');
    expect(relativeTime(now - 3 * 60_000, now)).toBe('3 min ago');
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe('2 h ago');
    expect(relativeTime(now - 3 * 86_400_000, now)).toMatch(/^on /);
    expect(relativeTime(now + 10_000, now)).toBe('just now');
  });

  it('counts', () => {
    expect(CATEGORY_TEXTS.books(1)).toBe('1 book');
    expect(CATEGORY_TEXTS.books(12345)).toBe('12,345 books');
    expect(CATEGORY_TEXTS.scanning(3, 1)).toBe('Scanning… 3 books in 1 folder');
  });
});
