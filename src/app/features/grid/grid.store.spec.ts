import { TestBed } from '@angular/core/testing';
import { BooksApi } from '../../core/books/books-api';
import { CategoriesApi } from '../../core/categories/categories-api';
import { ScanApi } from '../../core/scan/scan-api';
import { FakeBooksApi } from '../../../testing/fake-books-api';
import { FakeCategoriesApi } from '../../../testing/fake-categories-api';
import { FakeScanApi } from '../../../testing/fake-scan-api';
import { book, books, category, config, stats } from '../../../testing/fixtures';
import { CategoriesStore } from '../categories/categories.store';
import { CategoryStore } from '../category/category.store';
import { FILTER_DEBOUNCE_MS, GridStore, VIEW_STATE_STORE } from './grid.store';
import { KeyValueStore } from './view-state';
import { ReaderApi } from '../../core/reader/reader-api';
import { ReaderService } from '../reader/reader.service';
import { FakeReaderApi } from '../../../testing/fake-reader-api';

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function setup(cats = [category('c1', { initialFilter: '+bessy' }), category('c2')]) {
  const data = new Map<string, string>();
  const store: KeyValueStore = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
  TestBed.configureTestingModule({
    providers: [
      CategoryStore,
      GridStore,
      { provide: CategoriesApi, useClass: FakeCategoriesApi },
      { provide: ScanApi, useClass: FakeScanApi },
      { provide: BooksApi, useClass: FakeBooksApi },
      { provide: ReaderApi, useClass: FakeReaderApi },
      { provide: FILTER_DEBOUNCE_MS, useValue: 1 },
      { provide: VIEW_STATE_STORE, useValue: store },
    ],
  });
  (TestBed.inject(CategoriesApi) as FakeCategoriesApi).loaded = {
    config: config(cats),
    warning: null,
  };
  const categories = TestBed.inject(CategoriesStore);
  await categories.load();
  const scan = TestBed.inject(CategoryStore);
  const grid = TestBed.inject(GridStore);
  TestBed.tick();
  await scan.open(categories.active()!.id);
  const api = TestBed.inject(ScanApi) as FakeScanApi;
  const emit = (list = books('Bessy 2.cbz', 'Bessy 10.cbz', 'Hägar 1.cbz')) =>
    api.last.emit({ kind: 'cached', books: list, scannedAt: 1, stats: stats(), complete: true });
  return { grid, scan, categories, emit, data, booksApi: TestBed.inject(BooksApi) as FakeBooksApi };
}

const names = (g: GridStore) => g.filtered().map((b) => b.relPath);

describe('GridStore', () => {
  it('starts with the initial filter of the category, filters debounced', async () => {
    const { grid, emit } = await setup();
    emit();
    expect(grid.filterText()).toBe('+bessy');
    expect(names(grid)).toEqual(['Bessy 2.cbz', 'Bessy 10.cbz']);
    expect(grid.total()).toBe(3);
    grid.setFilter('hägar');
    expect(names(grid).length).toBe(2); // not yet
    await wait(5);
    expect(names(grid)).toEqual(['Hägar 1.cbz']);
    grid.applyFilterNow('');
    expect(names(grid).length).toBe(3);
  });

  it('takes new books of the background scan without losing the cursor', async () => {
    const { grid, emit, categories } = await setup();
    emit();
    grid.applyFilterNow('');
    grid.focusIndex(1);
    expect(grid.focused()?.relPath).toBe('Bessy 10.cbz');
    const api = TestBed.inject(ScanApi) as FakeScanApi;
    api.last.emit({ kind: 'diff', added: books('Asterix 1.cbz'), removed: [], changed: [] });
    api.last.emit({ kind: 'done', scannedAt: 2, stats: stats() });
    expect(grid.cursor()).toBe(2);
    expect(grid.focused()?.relPath).toBe('Bessy 10.cbz');
    expect(categories.active()!.id).toBe('c1');
  });

  it('orders, sizes and moves the cursor', async () => {
    const { grid, emit } = await setup();
    emit([
      book('a.cbz', { size: 1, modifiedMs: 3 }),
      book('b.cbz', { size: 3, modifiedMs: 1 }),
      book('c.cbz', { size: 2, modifiedMs: 2 }),
    ]);
    grid.applyFilterNow('');
    grid.setSort('size');
    expect(names(grid)).toEqual(['b.cbz', 'c.cbz', 'a.cbz']);
    grid.setSort('date');
    expect(names(grid)).toEqual(['a.cbz', 'c.cbz', 'b.cbz']);
    expect(grid.dimIndex()).toBe(1); // category.dimIndex
    grid.stepDim(-1);
    expect(grid.dim().width).toBe(200);
    grid.stepDim(-1);
    expect(grid.dim().width).toBe(200);
    grid.stepDim(1);
    expect(grid.dim().width).toBe(800);
    grid.move('right', 2, 1);
    expect(grid.cursor()).toBe(0); // no cursor yet → first
    grid.move('down', 2, 1);
    expect(grid.cursor()).toBe(2);
  });

  it('remembers its state per category and restores it', async () => {
    const { grid, emit, data, categories } = await setup();
    emit();
    grid.applyFilterNow('bessy');
    grid.setSort('name');
    grid.focusIndex(1);
    grid.topId.set(grid.filtered()[1].id);
    TestBed.tick();
    await wait(350);
    expect(JSON.parse(data.get('cc.view.c1')!)).toMatchObject({
      v: 2,
      filter: 'bessy',
      sort: 'name',
    });
    await categories.select('c2');
    TestBed.tick();
    expect(grid.filterText()).toBe('');
    expect(grid.sort()).toBe('path');
    await categories.select('c1');
    TestBed.tick();
    expect(grid.filterText()).toBe('bessy');
    expect(grid.sort()).toBe('name');
    expect(grid.restoreTopId()).toBe(grid.topId());
    expect(grid.focusId()).not.toBeNull();
  });

  it('filters the series and runs the actions by ids', async () => {
    const { grid, emit, booksApi } = await setup();
    emit();
    const b = grid.filtered()[1];
    grid.filterSeries(book('x/Hägar 01 – Wikinger.cbz'));
    expect(grid.filterText()).toBe('series:"Hägar"');
    expect(names(grid)).toEqual(['Hägar 1.cbz']);
    await grid.openExternal(b);
    await grid.reveal(b);
    expect(booksApi.calls).toEqual([`open c1.${b.id}`, `reveal c1.${b.id}`]);
    booksApi.failWith = { code: 'unknown_book', message: 'x' };
    await grid.reveal(b);
    expect(grid.message()).toEqual({
      text: 'The book is no longer in the list – scan the category again.',
      error: true,
    });
  });

  it('saves a change at once when the category is switched (review 004 #5)', async () => {
    const { grid, emit, data, categories } = await setup();
    emit();
    grid.applyFilterNow('quick');
    TestBed.tick();
    await categories.select('c2');
    TestBed.tick();
    expect(JSON.parse(data.get('cc.view.c1')!)).toMatchObject({ filter: 'quick' });
  });

  it('asks the grid to scroll only for moves of the user (review 004 #3)', async () => {
    const { grid, emit } = await setup();
    emit();
    grid.applyFilterNow('');
    const t0 = grid.revealTick();
    const api = TestBed.inject(ScanApi) as FakeScanApi;
    grid.focusIndex(1);
    expect(grid.revealTick()).toBe(t0 + 1);
    api.last.emit({ kind: 'diff', added: books('0 first.cbz'), removed: [], changed: [] });
    api.last.emit({ kind: 'done', scannedAt: 2, stats: stats() });
    expect(grid.cursor()).toBe(2);
    expect(grid.revealTick()).toBe(t0 + 1);
    grid.move('left', 2, 1);
    expect(grid.revealTick()).toBe(t0 + 2);
  });

  it('restores the cursor book when no top book was saved (review 004 #7)', async () => {
    const { grid, data, categories } = await setup();
    data.set(
      'cc.view.c2',
      JSON.stringify({ v: 1, filter: '', dimIndex: 0, sort: 'path', focusId: 'f1', topId: null }),
    );
    await categories.select('c2');
    TestBed.tick();
    expect(grid.restoreTopId()).toBe('f1');
  });

  it('reads a book within the filtered list and gets the cursor back (design 005 E6)', async () => {
    const { grid, emit } = await setup();
    emit();
    const reader = TestBed.inject(ReaderService);
    const bessy10 = grid.filtered()[1];
    grid.read(bessy10);
    expect(reader.session()).toMatchObject({ categoryId: 'c1', index: 1 });
    expect(reader.session()!.books.map((b) => b.relPath)).toEqual(['Bessy 2.cbz', 'Bessy 10.cbz']);
    reader.move(-1);
    const t0 = grid.revealTick();
    reader.close();
    TestBed.tick();
    expect(grid.focused()?.relPath).toBe('Bessy 2.cbz');
    expect(grid.revealTick()).toBe(t0 + 1);
  });

  describe('views and levels (design 011)', () => {
    const library = () => [
      book('A/Asterix/Asterix 10.cbz'),
      book('A/Asterix/Asterix 02.cbz'),
      book('A/Asterix/Asterix 01.cbz'),
      book('X/abc.cbz', { meta: { series: 'Saga', number: '2' } }),
      book('X/def.cbz', { meta: { series: 'Saga', number: '1' } }),
      book('B/Bessy/001_Bessy_ _Eins.cbr'),
      book('B/Bessy/002_Bessy_ _Zwei.cbr'),
      book('Watchmen.cbz'),
    ];
    const tiles = (g: GridStore) =>
      g
        .items()
        .map((i) =>
          i.id.startsWith('s:') || i.id.startsWith('d:')
            ? i.id
            : (i as { book: { name: string } }).book.name,
        );

    async function ready() {
      const s = await setup([category('c1'), category('c2')]);
      s.emit(library());
      s.grid.applyFilterNow('');
      return s;
    }

    it('series: 3 tiles, a click opens the volumes in number order, read follows them', async () => {
      const { grid } = await ready();
      grid.setView('series');
      expect(tiles(grid)).toEqual(['s:asterix', 's:bessy', 's:saga', 'Watchmen.cbz']);
      const asterix = grid.items()[0];
      grid.open(asterix);
      expect(grid.level()).toBe('asterix');
      expect(tiles(grid)).toEqual(['Asterix 01.cbz', 'Asterix 02.cbz', 'Asterix 10.cbz']);
      expect(grid.focused()?.name).toBe('Asterix 01.cbz');
      expect(grid.crumbs().map((c) => c.label)).toEqual(['All series', 'Asterix']);
      const reader = TestBed.inject(ReaderService);
      grid.read(grid.levelBooks()[1]);
      expect(reader.session()!.books.map((b) => b.name)).toEqual([
        'Asterix 01.cbz',
        'Asterix 02.cbz',
        'Asterix 10.cbz',
      ]);
      expect(reader.session()!.index).toBe(1);
      expect(grid.up()).toBe(true);
      expect(grid.level()).toBeNull();
      expect(grid.focusId()).toBe('s:asterix');
      expect(grid.up()).toBe(false);
    });

    it('series via ComicInfo even when the names differ', async () => {
      const { grid } = await ready();
      grid.setView('series');
      grid.open(grid.items().find((i) => i.id === 's:saga')!);
      expect(tiles(grid)).toEqual(['def.cbz', 'abc.cbz']);
    });

    it('folders: breadcrumb, way back puts the cursor on the folder left', async () => {
      const { grid } = await ready();
      grid.setView('folders');
      expect(tiles(grid)).toEqual(['d:A', 'd:B', 'd:X', 'Watchmen.cbz']);
      grid.open(grid.items()[0]);
      grid.open(grid.items()[0]);
      expect(grid.level()).toBe('A/Asterix');
      expect(grid.crumbs().map((c) => c.label)).toEqual(['All folders', 'A', 'Asterix']);
      grid.goTo(null);
      expect(grid.focusId()).toBe('d:A');
      grid.open(grid.items()[0]);
      grid.open(grid.items()[0]);
      grid.up();
      expect(grid.level()).toBe('A');
      expect(grid.focusId()).toBe('d:A/Asterix');
    });

    it('switching the view keeps the cursor on the tile of the book', async () => {
      const { grid } = await ready();
      grid.focusIndex(grid.filtered().findIndex((b) => b.name === 'abc.cbz'));
      grid.setView('series');
      expect(grid.focusId()).toBe('s:saga');
    });

    it('the filter works inside the views; series: filter', async () => {
      const { grid } = await ready();
      grid.setView('series');
      grid.applyFilterNow('series:asterix');
      expect(tiles(grid)).toEqual(['s:asterix']);
      grid.applyFilterNow('-02');
      const a = grid.items().find((i) => i.id === 's:asterix');
      expect(a && a.kind === 'group' && `${a.count}/${a.total}`).toBe('2/3');
    });

    it('remembers view and level, leaves a level that is gone', async () => {
      const { grid, categories, data } = await ready();
      grid.setView('series');
      grid.open(grid.items()[0]);
      await categories.select('c2');
      TestBed.tick();
      const saved = JSON.parse(data.get('cc.view.c1')!);
      expect(saved).toMatchObject({ v: 2, view: 'series', level: 'asterix' });
      await categories.select('c1');
      TestBed.tick();
      expect(grid.view()).toBe('series');
      expect(grid.level()).toBe('asterix');
      // the scan says: no Asterix any more
      const api = TestBed.inject(ScanApi) as FakeScanApi;
      const gone = grid.levelBooks().map((b) => b.path);
      api.last.emit({ kind: 'diff', added: [], removed: gone, changed: [] });
      api.last.emit({ kind: 'done', scannedAt: 3, stats: stats() });
      TestBed.tick();
      expect(grid.level()).toBeNull();
    });
  });
});
