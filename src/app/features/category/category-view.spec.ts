import { TestBed } from '@angular/core/testing';
import { CategoriesApi } from '../../core/categories/categories-api';
import { ScanApi } from '../../core/scan/scan-api';
import { FakeCategoriesApi } from '../../../testing/fake-categories-api';
import { FakeScanApi } from '../../../testing/fake-scan-api';
import { CoversApi } from '../../core/covers/covers-api';
import { FakeCoversApi } from '../../../testing/fake-covers-api';
import { books, category, config, stats } from '../../../testing/fixtures';
import { CategoriesStore } from '../categories/categories.store';
import { DialogService } from '../../shared/dialog/dialog.service';
import { CategoryView } from './category-view';
import { Provider } from '@angular/core';
import { BooksApi } from '../../core/books/books-api';
import { FakeBooksApi } from '../../../testing/fake-books-api';
import { FILTER_DEBOUNCE_MS, GridStore, VIEW_STATE_STORE } from '../grid/grid.store';
import { ReaderApi } from '../../core/reader/reader-api';
import { FakeReaderApi } from '../../../testing/fake-reader-api';

const flush = () => new Promise((r) => setTimeout(r));

async function render(setup?: (api: FakeCategoriesApi) => void, providers: Provider[] = []) {
  TestBed.configureTestingModule({
    imports: [CategoryView],
    providers: [
      { provide: CategoriesApi, useClass: FakeCategoriesApi },
      { provide: ScanApi, useClass: FakeScanApi },
      { provide: CoversApi, useClass: FakeCoversApi },
      { provide: BooksApi, useClass: FakeBooksApi },
      { provide: ReaderApi, useClass: FakeReaderApi },
      { provide: VIEW_STATE_STORE, useValue: null },
      { provide: FILTER_DEBOUNCE_MS, useValue: 1 },
      ...providers,
    ],
  });
  const api = TestBed.inject(CategoriesApi) as FakeCategoriesApi;
  setup?.(api);
  const categories = TestBed.inject(CategoriesStore);
  await categories.load();
  const fixture = TestBed.createComponent(CategoryView);
  await fixture.whenStable();
  await flush();
  const scan = TestBed.inject(ScanApi) as FakeScanApi;
  const el = fixture.nativeElement as HTMLElement;
  const update = async () => {
    await flush();
    await fixture.whenStable();
  };
  return { fixture, api, scan, el, categories, update };
}

const twoCategories = (api: FakeCategoriesApi) => {
  api.loaded = {
    config: config([category('c1'), category('c2', { title: 'Make' })]),
    warning: null,
  };
};

describe('CategoryView', () => {
  it('first start: offers ~/Comics, create and import', async () => {
    const { el, scan } = await render((api) => (api.comicsDir = '/home/me/Comics'));
    expect(el.querySelector('#first-start-title')?.textContent).toContain('No category yet');
    const buttons = [...el.querySelectorAll('.first-start button')].map((b) =>
      b.textContent?.trim(),
    );
    expect(buttons).toEqual(['Use /home/me/Comics', 'Create category…', 'Import old config…']);
    expect(scan.opened).toEqual([]);
  });

  it('opens the active category and shows cache, then the fresh state', async () => {
    const { el, scan, update, fixture } = await render(twoCategories);
    expect(scan.opened.map((o) => o.id)).toEqual(['c1']);
    scan.last.emit({
      kind: 'cached',
      books: books('b.cbz', 'a.cbz'),
      scannedAt: Date.now(),
      stats: stats(),
      complete: true,
    });
    scan.last.emit({ kind: 'started', firstScan: false });
    await update();
    const grid = fixture.debugElement.injector.get(GridStore);
    expect(grid.filtered().map((b) => b.relPath)).toEqual(['a.cbz', 'b.cbz']);
    expect(el.querySelector('app-cover-grid')).not.toBeNull();
    expect(el.querySelector('[role=status]')?.textContent).toContain('refreshing');
    scan.last.emit({ kind: 'diff', added: [], removed: [], changed: [] });
    scan.last.emit({ kind: 'done', scannedAt: Date.now(), stats: stats({ skippedDirLinks: 2 }) });
    await update();
    const status = el.querySelector('[role=status]')?.textContent ?? '';
    expect(status).toContain('2 books · updated just now · 2 linked folders skipped');
  });

  it('a changed category starts a new scan', async () => {
    const { scan, categories, update } = await render(twoCategories);
    await categories.select('c2');
    await update();
    expect(scan.opened.map((o) => o.id)).toEqual(['c1', 'c2']);
    // same category, other file types → scan again
    const cfg = categories.config();
    await categories.save({
      ...cfg,
      categories: cfg.categories.map((c) =>
        c.id === 'c2' ? { ...c, bookExtensions: ['.pdf'] } : c,
      ),
    });
    await update();
    expect(scan.opened.map((o) => o.id)).toEqual(['c1', 'c2', 'c2']);
  });

  it('unreachable folder: cache stays, hint instead of an error', async () => {
    const { el, scan, update } = await render(twoCategories);
    scan.last.emit({
      kind: 'cached',
      books: books('a.cbz'),
      scannedAt: 1_700_000_000_000,
      stats: stats(),
      complete: true,
    });
    scan.last.emit({ kind: 'failed', error: { code: 'not_found', message: 'x' }, cacheKept: true });
    await update();
    expect(el.querySelector('[role=status]')?.textContent).toContain('Folder not reachable');
    expect(el.querySelector('app-cover-grid')).not.toBeNull();
  });

  it('missing folder without cache: error text and „Edit category…“', async () => {
    const { el, scan, update } = await render(twoCategories);
    scan.last.emit({ kind: 'started', firstScan: true });
    scan.last.emit({
      kind: 'failed',
      error: { code: 'not_found', message: 'secret' },
      cacheKept: false,
    });
    await update();
    const status = el.querySelector('[role=status]')?.textContent ?? '';
    expect(status).toContain('The folder does not exist.');
    expect(status).not.toContain('secret');
    expect(el.textContent).toContain('Edit category…');
  });

  it('first scan can be cancelled', async () => {
    const { el, scan, update } = await render(twoCategories);
    scan.last.emit({ kind: 'started', firstScan: true });
    await update();
    const cancel = [...el.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Cancel',
    );
    cancel?.click();
    expect(scan.cancelled).toEqual(['c1']);
  });

  it('shows the grid with filter, sizes and order once there are books', async () => {
    const { el, scan, update, fixture } = await render(twoCategories);
    expect(el.querySelector('app-cover-grid')).toBeNull();
    expect(el.querySelector('input[type="search"]')).toBeNull();
    scan.last.emit({
      kind: 'cached',
      books: books('Bessy 1.cbz', 'Bessy 2.cbz', 'Hägar 1.cbz'),
      scannedAt: 1,
      stats: stats(),
      complete: true,
    });
    await update();
    expect(el.querySelector('app-cover-grid')).not.toBeNull();
    expect(el.querySelector('.toolbar')!.classList.contains('floating')).toBe(true);
    const input = el.querySelector('input[type="search"]') as HTMLInputElement;
    input.value = 'bessy';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 10));
    await update();
    expect(el.querySelector('.filter .count')!.textContent!.trim()).toBe('2 / 3');
    input.value = 'nothing';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await update();
    expect(el.textContent).toContain('No book matches the filter.');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await update();
    expect(input.value).toBe('');
    const selects = [...el.querySelectorAll('select')].map((s) =>
      [...s.options].map((o) => o.textContent!.trim()),
    );
    expect(selects).toEqual([
      ['200 × 300', '800 × 1200'],
      ['Folder and name', 'File name', 'Newest first', 'Largest first'],
    ]);
    const grid = fixture.debugElement.injector.get(GridStore);
    expect(grid.dimIndex()).toBe(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '-', ctrlKey: true }));
    expect(grid.dimIndex()).toBe(0);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }));
    expect(document.activeElement).toBe(input);
  });

  it('puts keys typed in the grid into the filter', async () => {
    const { el, scan, update, fixture } = await render(twoCategories);
    scan.last.emit({
      kind: 'cached',
      books: books('a.cbz'),
      scannedAt: 1,
      stats: stats(),
      complete: true,
    });
    await update();
    const gridEl = el.querySelector('app-cover-grid') as HTMLElement;
    gridEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    await update();
    const grid = fixture.debugElement.injector.get(GridStore);
    expect(grid.filterText()).toBe('x');
    expect(document.activeElement).toBe(el.querySelector('input[type="search"]'));
    gridEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(grid.filterText()).toBe('');
  });

  it('Mod+R scans again, Mod+2 chooses the second category', async () => {
    const { scan, categories, update } = await render(twoCategories);
    scan.last.emit({ kind: 'done', scannedAt: 1, stats: stats() });
    await update();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true }));
    await update();
    expect(scan.opened.map((o) => o.id)).toEqual(['c1', 'c1']);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '2', metaKey: true }));
    await update();
    expect(categories.active()?.id).toBe('c2');
  });

  it('keys are left alone while a dialog is open', async () => {
    const { scan, update } = await render(twoCategories);
    scan.last.emit({ kind: 'done', scannedAt: 1, stats: stats() });
    TestBed.inject(DialogService).show('categories');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', ctrlKey: true }));
    await update();
    expect(scan.opened.length).toBe(1);
  });
});
