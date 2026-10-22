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
      v: 1,
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
    expect(grid.filterText()).toBe('+Hägar');
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
});
