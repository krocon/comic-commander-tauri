import { book } from '../../../testing/fixtures';
import { filterKey } from '../category/book-order';
import { bookInfo } from './book-info';
import { hasFieldTerms, isEmptyFilter, matchesFilter, parseFilter } from './filter-logic';
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

  it('a field term with an empty filter is not empty', () => {
    expect(isEmptyFilter(parseFilter('year:1990'))).toBe(false);
    expect(hasFieldTerms(parseFilter('series:a'))).toBe(true);
    expect(hasFieldTerms(parseFilter('a +b -c'))).toBe(false);
  });
});

describe('filter-logic: field terms (design 011 E8)', () => {
  const library = [
    book('a/Asterix 01 - Der Gallier (1961).cbz'),
    book('a/Asterix 02 - Die goldene Sichel (1962).cbz'),
    book('a/Asterix Classics 03.cbz'),
    book('x/abc123.cbz', {
      meta: {
        series: 'Asterix',
        number: '4',
        year: 1963,
        writer: 'René Goscinny',
        publisher: 'Ehapa',
      },
    }),
    book('i/Im roten Bereich 01 - Carrera (Salleck 2015).cbz'),
    book('i/Im_roten_Bereich_02_(2016).cbz'),
    book('s/series:x 01.cbz'),
    book('h/Hägar 01 (1973).cbz'),
  ];
  const hits = (filter: string) => {
    const f = parseFilter(filter);
    return library
      .filter((b) => matchesFilter(filterKey(b), f, () => bookInfo(b)))
      .map((b) => b.name);
  };

  it.each([
    ['series:asterix', 4],
    ['series:"asterix classics"', 1],
    ['series:"im roten bereich"', 2],
    ['series:im_roten', 2],
    ['+series:asterix -series:classics', 3],
    ['series:hägar', 1],
    ['series:Ha\u0308gar', 1],
    ['year:1962', 1],
    ['year:1961-1963', 3],
    ['year:1963-1961', 3],
    ['+year:2015-2016 +series:bereich', 2],
    ['-year:1900-1999', 4],
    ['writer:gosc', 1],
    ['publisher:EHAPA', 1],
    ['series:asterix hägar', 5],
    ['series:nope carrera', 1],
    ['+gallier series:asterix', 1],
  ])('%s → %i', (filter, count) => {
    expect(hits(filter)).toHaveLength(count);
  });

  it('unknown fields, empty values and no years stay plain words (compatible)', () => {
    expect(hits('series:zzz')).toEqual([]); // a field, no such series
    expect(hits('series:""')).toEqual([]); // empty quotes: a word not in any path
    expect(hits('+series:')).toEqual(['series:x 01.cbz']); // empty value: a word
    expect(hits('foo:bar')).toEqual([]);
    expect(hits('year:abc')).toEqual([]);
    expect(parseFilter('year:19').musts).toEqual([]);
    expect(parseFilter('year:19').ors).toEqual(['year:19']);
    expect(parseFilter('http://x').ors).toEqual(['http://x']);
  });

  it('a quote that is not closed takes the rest', () => {
    expect(parseFilter('series:"im roten').orFields[0].text).toBe('im roten');
  });

  it('without field values a field term never matches', () => {
    expect(matchesFilter('a', parseFilter('series:a'))).toBe(false);
    expect(matchesFilter('a', parseFilter('-series:a'))).toBe(true);
  });
});
