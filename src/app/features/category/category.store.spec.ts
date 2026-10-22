import { TestBed } from '@angular/core/testing';
import { ScanApi } from '../../core/scan/scan-api';
import { FakeScanApi } from '../../../testing/fake-scan-api';
import { book, books, stats } from '../../../testing/fixtures';
import { CategoryStore, SORT_WHILE_SCANNING } from './category.store';

function setup() {
  TestBed.configureTestingModule({
    providers: [CategoryStore, { provide: ScanApi, useClass: FakeScanApi }],
  });
  return {
    store: TestBed.inject(CategoryStore),
    api: TestBed.inject(ScanApi) as FakeScanApi,
  };
}

const rels = (s: CategoryStore) => s.books().map((b) => b.relPath);

describe('CategoryStore', () => {
  it('cached → started → diff → done', async () => {
    const { store, api } = setup();
    await store.open('c1');
    const { emit } = api.last;
    emit({
      kind: 'cached',
      books: books('b 10.cbz', 'b 2.cbz', 'gone.cbz'),
      scannedAt: 1,
      stats: stats(),
      complete: true,
    });
    expect(rels(store)).toEqual(['b 2.cbz', 'b 10.cbz', 'gone.cbz']);
    expect(store.fromCache()).toBe(true);
    emit({ kind: 'started', firstScan: false });
    expect(store.books().length).toBe(3);
    emit({
      kind: 'diff',
      added: books('a.cbz'),
      removed: ['/lib/gone.cbz'],
      changed: [book('b 2.cbz', { size: 5 })],
    });
    expect(rels(store)).toEqual(['a.cbz', 'b 2.cbz', 'b 10.cbz']);
    expect(store.books()[1].size).toBe(5);
    emit({ kind: 'done', scannedAt: 9, stats: stats({ books: 3 }) });
    expect(store.phase()).toBe('done');
    expect(store.fromCache()).toBe(false);
    expect(store.scannedAt()).toBe(9);
  });

  it('first scan: batches arrive sorted', async () => {
    const { store, api } = setup();
    await store.open('c1');
    const { emit } = api.last;
    emit({ kind: 'started', firstScan: true });
    emit({ kind: 'batch', books: books('z.cbz') });
    emit({ kind: 'progress', books: 1, dirs: 3 });
    expect(store.progress()).toEqual({ books: 1, dirs: 3 });
    emit({ kind: 'batch', books: books('a.cbz') });
    expect(rels(store)).toEqual(['a.cbz', 'z.cbz']);
    emit({ kind: 'done', scannedAt: 1, stats: stats() });
    expect(store.progress()).toBeNull();
  });

  it('large first scans are sorted once at the end', async () => {
    const { store, api } = setup();
    await store.open('c1');
    const { emit } = api.last;
    emit({ kind: 'started', firstScan: true });
    const many = Array.from({ length: SORT_WHILE_SCANNING + 1 }, (_, i) =>
      book(`b${SORT_WHILE_SCANNING - i}`),
    );
    emit({ kind: 'batch', books: many });
    expect(store.books()[0].relPath).toBe(`b${SORT_WHILE_SCANNING}`);
    emit({ kind: 'done', scannedAt: 1, stats: stats() });
    expect(store.books()[0].relPath).toBe('b0');
  });

  it('drops events of an older open', async () => {
    const { store, api } = setup();
    await store.open('c1');
    const old = api.last.emit;
    await store.open('c2');
    old({ kind: 'cached', books: books('old.cbz'), scannedAt: 1, stats: stats(), complete: true });
    expect(store.books()).toEqual([]);
    expect(store.categoryId()).toBe('c2');
  });

  it('a rescan of the same category keeps the list, another category clears it', async () => {
    const { store, api } = setup();
    await store.open('c1');
    api.last.emit({
      kind: 'cached',
      books: books('a.cbz'),
      scannedAt: 1,
      stats: stats(),
      complete: true,
    });
    await store.rescan();
    expect(rels(store)).toEqual(['a.cbz']);
    expect(api.opened.map((o) => o.id)).toEqual(['c1', 'c1']);
    await store.open('c2');
    expect(store.books()).toEqual([]);
  });

  it('failed keeps the cached books', async () => {
    const { store, api } = setup();
    await store.open('c1');
    const { emit } = api.last;
    emit({ kind: 'cached', books: books('a.cbz'), scannedAt: 1, stats: stats(), complete: true });
    emit({ kind: 'started', firstScan: false });
    emit({ kind: 'failed', error: { code: 'not_found', message: 'x' }, cacheKept: true });
    expect(store.phase()).toBe('failed');
    expect(store.cacheKept()).toBe(true);
    expect(rels(store)).toEqual(['a.cbz']);
  });

  it('cancel only while scanning', async () => {
    const { store, api } = setup();
    await store.open('c1');
    await store.cancel();
    expect(api.cancelled).toEqual(['c1']);
    api.last.emit({ kind: 'cancelled' });
    await store.cancel();
    expect(api.cancelled).toEqual(['c1']);
    expect(store.phase()).toBe('cancelled');
  });

  it('an unknown category fails at once', async () => {
    const { store, api } = setup();
    api.failOpen = { code: 'unknown_category', message: 'x' };
    await store.open('gone');
    expect(store.phase()).toBe('failed');
    expect(store.error()?.code).toBe('unknown_category');
  });

  it('no category = idle', async () => {
    const { store, api } = setup();
    await store.open(null);
    expect(store.phase()).toBe('idle');
    expect(api.opened).toEqual([]);
  });

  it('shows a cache sent in parts at once and sorts it when complete (design 004)', async () => {
    const { store, api } = setup();
    await store.open('c1');
    const { emit } = api.last;
    emit({
      kind: 'cached',
      books: books('c.cbz'),
      scannedAt: 1,
      stats: stats(),
      complete: false,
    });
    expect(rels(store)).toEqual(['c.cbz']);
    expect(store.fromCache()).toBe(true);
    emit({ kind: 'cachedMore', books: books('a.cbz'), complete: false });
    expect(rels(store)).toEqual(['c.cbz', 'a.cbz']); // order of Rust until complete
    emit({ kind: 'cachedMore', books: books('b.cbz'), complete: true });
    expect(rels(store)).toEqual(['a.cbz', 'b.cbz', 'c.cbz']);
    // a new open drops the parts of the old one
    emit({ kind: 'cached', books: books('x.cbz'), scannedAt: 1, stats: stats(), complete: false });
    await store.open('c2');
    api.last.emit({
      kind: 'cached',
      books: books('y.cbz'),
      scannedAt: 1,
      stats: stats(),
      complete: true,
    });
    expect(rels(store)).toEqual(['y.cbz']);
  });
});
