import { TestBed } from '@angular/core/testing';
import { LibraryApi } from '../../core/library/library-api';
import { FakeLibraryApi } from '../../../testing/fake-library-api';
import { libraryScan } from '../../../testing/fixtures';
import { LibraryStore } from './library.store';

function setup() {
  TestBed.configureTestingModule({
    providers: [LibraryStore, { provide: LibraryApi, useClass: FakeLibraryApi }],
  });
  return {
    store: TestBed.inject(LibraryStore),
    api: TestBed.inject(LibraryApi) as FakeLibraryApi,
  };
}

const flush = () => new Promise((r) => setTimeout(r));

describe('LibraryStore', () => {
  it('init scans the default folder', async () => {
    const { store, api } = setup();
    const done = store.init();
    await flush();
    expect(store.root()).toBe('/home/test/Comics');
    expect(store.loading()).toBe(true);
    expect(api.pending.map((p) => p.root)).toEqual(['/home/test/Comics']);
    api.pending[0].resolve(libraryScan('/home/test/Comics', ['a.cbz', 'b.cbr']));
    await done;
    expect(store.loading()).toBe(false);
    expect(store.books().map((b) => b.relPath)).toEqual(['a.cbz', 'b.cbr']);
  });

  it('drops a stale answer of an older scan', async () => {
    const { store, api } = setup();
    const first = store.load('/old');
    const second = store.load('/new');
    api.pending[1].resolve(libraryScan('/new', ['new.cbz']));
    await second;
    api.pending[0].resolve(libraryScan('/old', ['old.cbz']));
    await first;
    expect(store.root()).toBe('/new');
    expect(store.books().map((b) => b.relPath)).toEqual(['new.cbz']);
    expect(store.loading()).toBe(false);
  });

  it('keeps the error of a failed scan', async () => {
    const { store, api } = setup();
    const done = store.load('/missing');
    api.pending[0].reject({ code: 'not_found', message: 'nope', path: '/missing' });
    await done;
    expect(store.error()?.code).toBe('not_found');
    expect(store.scan()).toBeNull();
    expect(store.loading()).toBe(false);
  });
});
