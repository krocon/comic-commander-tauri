import { isEmptyFilter, matchesFilter, parseFilter } from './filter-logic';
import catalog from './filter-logic.cases.json';

const key = (relPath: string) => relPath.normalize('NFC').toLowerCase();

describe('filter-logic (catalog of the template + Unicode)', () => {
  for (const c of catalog.cases) {
    it(`"${c.filter}"`, () => {
      const f = parseFilter(c.filter);
      const hits = catalog.files.filter((p) => matchesFilter(key(p), f));
      if ('list' in c) expect(hits).toEqual(c.list);
      else expect(hits.length).toBe(c.count);
    });
  }

  it('knows an empty filter', () => {
    expect(isEmptyFilter(parseFilter(' + - '))).toBe(true);
    expect(isEmptyFilter(parseFilter('-x'))).toBe(false);
  });
});
