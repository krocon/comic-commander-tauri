import { TestBed } from '@angular/core/testing';
import { CategoriesApi } from '../../core/categories/categories-api';
import { FakeCategoriesApi } from '../../../testing/fake-categories-api';
import { category, config } from '../../../testing/fixtures';
import { CategoriesStore } from './categories.store';
import { ImportDialog } from './import-dialog';

const flush = () => new Promise((r) => setTimeout(r));

describe('ImportDialog', () => {
  it('shows the preview, unticks duplicates, adds the ticked ones', async () => {
    TestBed.configureTestingModule({
      imports: [ImportDialog],
      providers: [{ provide: CategoriesApi, useClass: FakeCategoriesApi }],
    });
    const api = TestBed.inject(CategoriesApi) as FakeCategoriesApi;
    api.loaded = { config: config([category('c1')]), warning: null };
    api.importResult = {
      file: '/old/config-mac.json',
      categories: [
        { ...category(''), title: 'Comics', baseDir: '/comics/c1' },
        { ...category(''), title: 'Make', baseDir: '/x/ct Make', bookExtensions: ['.pdf'] },
      ],
      notes: [
        { index: 0, title: 'Comics', code: 'duplicate', detail: null },
        { index: 1, title: 'Make', code: 'missing_dir', detail: null },
        { index: null, title: 'Epub', code: 'no_extension', detail: null },
      ],
    };
    const store = TestBed.inject(CategoriesStore);
    await store.load();
    await store.startImport();
    const fixture = TestBed.createComponent(ImportDialog);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const boxes = [...el.querySelectorAll('tbody input[type=checkbox]')] as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([false, true]);
    expect(el.textContent).toContain('Already exists.');
    expect(el.textContent).toContain('Folder not found (imported anyway).');
    expect(el.textContent).toContain('„Epub“ – No supported file type.');
    [...el.querySelectorAll('button')]
      .find((b) => b.textContent?.trim() === 'Add selected')!
      .click();
    await flush();
    expect(store.categories().map((c) => c.title)).toEqual(['Title c1', 'Make']);
  });
});
