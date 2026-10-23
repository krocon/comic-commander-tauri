import { pagePath } from './reader-api';

describe('page URLs', () => {
  it('carry a token, the page and the width – never a path', () => {
    expect(pagePath('0123456789abcdef', 12, 2048)).toBe('0123456789abcdef.12.2048');
    const p = pagePath('0123456789abcdef', 0, 0);
    expect(encodeURIComponent(p)).toBe(p);
  });
});
