import { book } from '../../../testing/fixtures';
import { bookInfo, numberValue, parseBookName, seriesKey } from './book-info';
import catalog from './book-info.cases.json';

interface Case {
  name: string;
  folder?: string | null;
  series: string | null;
  number?: string;
  volume?: number;
  title?: string;
  year?: number;
  fromFolder?: boolean;
}

describe('parseBookName (catalog, design 011)', () => {
  for (const c of catalog.cases as Case[]) {
    it(`${JSON.stringify(c.name)}${c.folder ? ` in ${c.folder}` : ''}`, () => {
      expect(parseBookName(c.name, c.folder ?? null)).toEqual({
        series: c.series,
        number: c.number ?? null,
        volume: c.volume ?? null,
        title: c.title ?? null,
        year: c.year ?? null,
        fromFolder: c.fromFolder ?? false,
      });
    });
  }

  it('has a large catalog', () => {
    expect(catalog.cases.length).toBeGreaterThanOrEqual(60);
  });
});

describe('seriesKey and numberValue', () => {
  it('groups spellings together', () => {
    expect(seriesKey('Hägar')).toBe(seriesKey('Hägar'));
    expect(seriesKey('  Im_roten   Bereich - ')).toBe('im roten bereich');
    expect(seriesKey('ASTERIX')).toBe('asterix');
    expect(seriesKey('')).toBeNull();
    expect(seriesKey(null)).toBeNull();
  });

  it('reads numbers', () => {
    expect(numberValue('01')).toBe(1);
    expect(numberValue('1.5')).toBe(1.5);
    expect(numberValue('45,5')).toBe(45.5);
    expect(numberValue('12a')).toBe(12);
    expect(numberValue('01-2024')).toBe(202401);
    expect(numberValue('2024-05')).toBe(202405);
    expect(numberValue('x')).toBeNull();
    expect(numberValue(null)).toBeNull();
  });
});

describe('bookInfo: ComicInfo field by field before the name (E5)', () => {
  it('uses the name without ComicInfo', () => {
    const i = bookInfo(book('a/Asterix 03 - Kleopatra (1968).cbz'));
    expect(i).toMatchObject({
      series: 'Asterix',
      seriesKey: 'asterix',
      seriesSource: 'name',
      number: '03',
      numberValue: 3,
      title: 'Kleopatra',
      year: 1968,
      writer: null,
    });
  });

  it('ComicInfo wins where it has a value', () => {
    const i = bookInfo(
      book('x/abc123.cbz', { meta: { series: 'Asterix', number: '2', writer: 'Goscinny' } }),
    );
    expect(i).toMatchObject({
      series: 'Asterix',
      seriesSource: 'comicinfo',
      number: '2',
      numberValue: 2,
      writer: 'Goscinny',
    });
    // the year only from the name
    const j = bookInfo(book('Saga 05 (2014).cbz', { meta: { title: 'Fünf' } }));
    expect(j).toMatchObject({ series: 'Saga', number: '05', title: 'Fünf', year: 2014 });
  });

  it('takes the folder when the name starts with the number', () => {
    const i = bookInfo(book('b/Bessy/005_Bessy_ _Im_Tal.cbr'));
    expect(i).toMatchObject({ series: 'Bessy', seriesSource: 'folder', number: '005' });
    expect(bookInfo(book('Watchmen.cbz')).seriesSource).toBe('name');
    expect(bookInfo(book('01.cbz')).seriesSource).toBeNull();
  });

  it('is computed once per book object', () => {
    const b = book('Saga 1.cbz');
    expect(bookInfo(b)).toBe(bookInfo(b));
  });
});
