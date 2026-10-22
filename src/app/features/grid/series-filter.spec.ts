import { extractSeriesFilter } from './series-filter';

describe('extractSeriesFilter (cases of the template)', () => {
  it.each([
    ['Im roten Bereich 01 - Carrera ( Salleck 2015) (TP) (2560)', '+Im +roten +Bereich'],
    ['Action Comics 1000.cbz', '+Action +Comics'],
    ['Spider-Man - 01.cbr', '+Spider-Man'],
    ['Spider-Man 01.cbr', '+Spider-Man'],
    ['Bessy.cbr', '+Bessy'],
    ['', ''],
    ['Neptun_01_-_Episode_1_(2022)_(Splitter)_(digital)_(Lynx-Empire).cbr', '+Neptun'],
    ['Hägar 🦸 02.cbz', '+Hägar +🦸'],
    ['.cbz', '+.cbz'],
  ])('%s → %s', (name, expected) => {
    expect(extractSeriesFilter(name)).toBe(expected);
  });
});
