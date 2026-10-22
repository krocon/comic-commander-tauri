import { TestBed } from '@angular/core/testing';
import { CategoriesApi } from '../../core/categories/categories-api';
import { ScanApi } from '../../core/scan/scan-api';
import { FakeCategoriesApi } from '../../../testing/fake-categories-api';
import { FakeScanApi } from '../../../testing/fake-scan-api';
import { books, category, config, stats } from '../../../testing/fixtures';
import { CategoriesStore } from '../categories/categories.store';
import { DialogService } from '../../shared/dialog/dialog.service';
import { CategoryView, MAX_LIST_ROWS } from './category-view';

const flush = () => new Promise((r) => setTimeout(r));

async function render(setup?: (api: FakeCategoriesApi) => void) {
  TestBed.configureTestingModule({
    imports: [CategoryView],
    providers: [
      { provide: CategoriesApi, useClass: FakeCategoriesApi },
      { provide: ScanApi, useClass: FakeScanApi },
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
    const { el, scan, update } = await render(twoCategories);
    expect(scan.opened.map((o) => o.id)).toEqual(['c1']);
    scan.last.emit({
      kind: 'cached',
      books: books('b.cbz', 'a.cbz'),
      scannedAt: Date.now(),
      stats: stats(),
    });
    scan.last.emit({ kind: 'started', firstScan: false });
    await update();
    expect([...el.querySelectorAll('.book .name')].map((n) => n.textContent?.trim())).toEqual([
      'a.cbz',
      'b.cbz',
    ]);
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
    });
    scan.last.emit({ kind: 'failed', error: { code: 'not_found', message: 'x' }, cacheKept: true });
    await update();
    expect(el.querySelector('[role=status]')?.textContent).toContain('Folder not reachable');
    expect(el.querySelectorAll('.book').length).toBe(1);
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

  it('renders at most MAX_LIST_ROWS rows', async () => {
    const { el, scan, update } = await render(twoCategories);
    const names = Array.from({ length: MAX_LIST_ROWS + 3 }, (_, i) => `b${i}.cbz`);
    scan.last.emit({ kind: 'cached', books: books(...names), scannedAt: 1, stats: stats() });
    await update();
    expect(el.querySelectorAll('.book').length).toBe(MAX_LIST_ROWS);
    expect(el.textContent).toContain('and 3 more');
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
