import { book } from '../../../testing/fixtures';
import { BookEntry } from '../../core/scan/scan.models';
import {
  breadcrumb,
  folderLevel,
  GridItem,
  GroupItem,
  groupBySeries,
  levelExists,
  levelTileId,
  parentLevel,
  seriesBooks,
} from './grouping';

const none = () => null;
const label = (i: GridItem) =>
  i.kind === 'group' ? `[${i.label} ${i.count}/${i.total}]` : i.book.name;

/** Three series in nested folders, one only through ComicInfo, one `NNN_Serie_…`, two single books. */
function library(): BookEntry[] {
  return [
    book('A/Asterix/Asterix 02 - Die goldene Sichel.cbz'),
    book('A/Asterix/Asterix 01 - Der Gallier.cbz'),
    book('A/Asterix/Asterix 10.cbz'),
    book('X/abc123.cbz', { meta: { series: 'Saga', number: '3' } }),
    book('X/def456.cbz', { meta: { series: 'Saga', number: '1' } }),
    book('X/ghi789.cbz', { meta: { series: 'saga', number: '2' } }),
    book('B/Bessy/005_Bessy_ _Im_Tal.cbr'),
    book('B/Bessy/001_Bessy_ _Das_Geheimnis.cbr'),
    book('Watchmen.cbz'),
    book('Hägar 🦸 01.cbz'),
  ];
}

describe('groupBySeries (design 011)', () => {
  it('shows 3 series with the right counts and the single books as books', () => {
    const all = library();
    const items = groupBySeries(all, all, 'path', none);
    expect(items.map(label)).toEqual([
      '[Asterix 3/3]',
      '[Bessy 2/2]',
      'Hägar 🦸 01.cbz',
      '[Saga 3/3]',
      'Watchmen.cbz',
    ]);
    const saga = items.find((i) => i.id === 's:saga') as GroupItem;
    expect(saga.cover.name).toBe('def456.cbz'); // number 1
    expect(saga.label).toBe('Saga');
  });

  it('opens a series in number order', () => {
    const all = library();
    expect(seriesBooks(all, 'asterix').map((b) => b.name)).toEqual([
      'Asterix 01 - Der Gallier.cbz',
      'Asterix 02 - Die goldene Sichel.cbz',
      'Asterix 10.cbz',
    ]);
    expect(seriesBooks(all, 'saga').map((b) => b.name)).toEqual([
      'def456.cbz',
      'ghi789.cbz',
      'abc123.cbz',
    ]);
  });

  it('the filter counts matches, hides series without any', () => {
    const all = library();
    const shown = all.filter((b) => b.name.includes('Asterix 0') || b.name === 'Watchmen.cbz');
    expect(groupBySeries(all, shown, 'path', none).map(label)).toEqual([
      '[Asterix 2/3]',
      'Watchmen.cbz',
    ]);
  });

  it('progress: mean over the series, read = at the end (E10)', () => {
    const all = library();
    const p = new Map([
      [all[0].id, 1],
      [all[1].id, 0.5],
    ]);
    const items = groupBySeries(all, all, 'path', (b) => p.get(b.id) ?? null);
    const asterix = items.find((i) => i.id === 's:asterix') as GroupItem;
    expect(asterix.read).toBe(1);
    expect(asterix.progress).toBeCloseTo(0.5);
    expect((items.find((i) => i.id === 's:saga') as GroupItem).progress).toBeNull();
  });

  it('newest first by the newest book of a group', () => {
    const all = [
      book('Old 1.cbz', { modifiedMs: 1 }),
      book('Old 2.cbz', { modifiedMs: 2 }),
      book('New 1.cbz', { modifiedMs: 1 }),
      book('New 2.cbz', { modifiedMs: 9 }),
      book('Single.cbz', { modifiedMs: 5 }),
    ];
    expect(groupBySeries(all, all, 'date', none).map(label)).toEqual([
      '[New 2/2]',
      'Single.cbz',
      '[Old 2/2]',
    ]);
  });

  it('groups 50 000 books quickly', () => {
    const all: BookEntry[] = [];
    for (let s = 0; s < 2500; s++)
      for (let i = 0; i < 20; i++) all.push(book(`d${s}/S${s} Band ${i}.cbz`));
    const t = performance.now();
    groupBySeries(all, all, 'path', none); // first time: bookInfo for every book
    const first = performance.now() - t;
    const t2 = performance.now();
    const items = groupBySeries(all, all, 'path', none);
    const again = performance.now() - t2;
    console.log(`MEASURE group 50k: first ${first.toFixed(0)} ms, again ${again.toFixed(0)} ms`);
    expect(items).toHaveLength(2500);
    expect(again).toBeLessThan(500);
  });
});

describe('folderLevel (design 011)', () => {
  it('sub folders first (subtree counts), then the books of the folder', () => {
    const all = library();
    expect(folderLevel(all, all, '', none).map(label)).toEqual([
      '[A 3/3]',
      '[B 2/2]',
      '[X 3/3]',
      'Watchmen.cbz',
      'Hägar 🦸 01.cbz',
    ]);
    expect(folderLevel(all, all, 'A', none).map(label)).toEqual(['[Asterix 3/3]']);
    const inner = folderLevel(all, all, 'A/Asterix', none);
    expect(inner.every((i) => i.kind === 'book')).toBe(true);
    expect(inner).toHaveLength(3);
    const a = folderLevel(all, all, '', none)[0] as GroupItem;
    expect(a.id).toBe('d:A');
    expect(a.cover.name).toBe('Asterix 01 - Der Gallier.cbz');
  });

  it('NFC and NFD of a folder are one tile', () => {
    const all = [book('Hägar/1.cbz'), book('Hägar/2.cbz')];
    const items = folderLevel(all, all, '', none);
    expect(items.map(label)).toEqual(['[Hägar 2/2]']);
    expect(folderLevel(all, all, 'Hägar', none)).toHaveLength(2);
  });

  it('a filter hides empty folders', () => {
    const all = library();
    const shown = all.filter((b) => b.relPath.startsWith('B/'));
    expect(folderLevel(all, shown, '', none).map(label)).toEqual(['[B 2/2]']);
  });
});

describe('levels', () => {
  it('parent, tile id, existence', () => {
    expect(parentLevel('folders', 'A/B/C')).toBe('A/B');
    expect(parentLevel('folders', 'A')).toBeNull();
    expect(parentLevel('series', 'saga')).toBeNull();
    expect(levelTileId('series', 'saga')).toBe('s:saga');
    expect(levelTileId('folders', 'A/B')).toBe('d:A/B');
    const all = library();
    expect(levelExists(all, 'series', 'saga')).toBe(true);
    expect(levelExists(all, 'series', 'gone')).toBe(false);
    expect(levelExists(all, 'folders', 'A/Asterix')).toBe(true);
    expect(levelExists(all, 'folders', 'A/Aste')).toBe(false);
  });

  it('breadcrumb', () => {
    expect(breadcrumb('flat', 'x', 'All', (k) => k)).toEqual([]);
    expect(breadcrumb('series', null, 'All', (k) => k)).toEqual([]);
    expect(breadcrumb('series', 'saga', 'All series', () => 'Saga')).toEqual([
      { label: 'All series', level: null },
      { label: 'Saga', level: 'saga' },
    ]);
    expect(breadcrumb('folders', 'A/B', 'All folders', (k) => k)).toEqual([
      { label: 'All folders', level: null },
      { label: 'A', level: 'A' },
      { label: 'B', level: 'A/B' },
    ]);
  });
});
