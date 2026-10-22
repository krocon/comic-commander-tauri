import { TestBed } from '@angular/core/testing';
import { CategoriesApi } from '../../core/categories/categories-api';
import { FakeCategoriesApi } from '../../../testing/fake-categories-api';
import { category, config } from '../../../testing/fixtures';
import { DialogService } from '../../shared/dialog/dialog.service';
import { CategoriesStore } from './categories.store';

function setup() {
  TestBed.configureTestingModule({
    providers: [{ provide: CategoriesApi, useClass: FakeCategoriesApi }],
  });
  return {
    store: TestBed.inject(CategoriesStore),
    api: TestBed.inject(CategoriesApi) as FakeCategoriesApi,
    dialogs: TestBed.inject(DialogService),
  };
}

describe('CategoriesStore', () => {
  it('loads the config and the active category', async () => {
    const { store, api } = setup();
    api.loaded = {
      config: config([category('c1'), category('c2')], 'c2'),
      warning: { code: 'broken', path: '/cfg/categories.json.bad' },
    };
    await store.load();
    expect(store.active()?.id).toBe('c2');
    expect(store.warning()?.code).toBe('broken');
    expect(store.loaded()).toBe(true);
  });

  it('offers ~/Comics only on the first start', async () => {
    const { store, api } = setup();
    api.comicsDir = '/home/me/Comics';
    await store.load();
    expect(store.comicsDir()).toBe('/home/me/Comics');
  });

  it('select saves the active id', async () => {
    const { store, api } = setup();
    api.loaded = { config: config([category('c1'), category('c2')]), warning: null };
    await store.load();
    await store.select('c2');
    expect(api.saved.at(-1)?.activeId).toBe('c2');
    expect(store.active()?.id).toBe('c2');
  });

  it('addFolder adds a category and activates it', async () => {
    const { store, api } = setup();
    api.loaded = { config: config([category('c1')]), warning: null };
    await store.load();
    expect(await store.addFolder('/home/me/Comics')).toBe(true);
    expect(store.categories().length).toBe(2);
    expect(store.active()?.baseDir).toBe('/home/me/Comics');
    expect(store.active()?.bookExtensions).toContain('.pdf');
  });

  it('keeps the error when the backend refuses', async () => {
    const { store, api } = setup();
    await store.load();
    api.saveError = { code: 'invalid_categories', message: 'x' };
    expect(await store.addFolder('relative')).toBe(false);
    expect(store.error()?.code).toBe('invalid_categories');
    expect(store.categories()).toEqual([]);
  });

  it('import: preview first, add the chosen categories with new ids', async () => {
    const { store, api, dialogs } = setup();
    api.loaded = { config: config([category('c1')]), warning: null };
    await store.load();
    const imported = { ...category(''), title: 'Make', bookExtensions: ['.pdf'] };
    api.importResult = { file: '/old/config.json', categories: [imported], notes: [] };
    await store.startImport();
    expect(dialogs.open()).toBe('import');
    expect(api.saved.length).toBe(0);
    await store.addImported(store.importPreview()?.categories ?? []);
    expect(store.categories().map((c) => c.title)).toEqual(['Title c1', 'Make']);
    expect(dialogs.open()).toBeNull();
    expect(store.importPreview()).toBeNull();
  });

  it('a cancelled import dialog changes nothing', async () => {
    const { store, dialogs } = setup();
    await store.startImport();
    expect(dialogs.open()).toBeNull();
  });
});
