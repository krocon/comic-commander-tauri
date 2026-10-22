import { TestBed } from '@angular/core/testing';
import { LibraryApi } from '../../core/library/library-api';
import { FakeLibraryApi } from '../../../testing/fake-library-api';
import { libraryScan } from '../../../testing/fixtures';
import { LibraryView, MAX_LIST_ROWS } from './library-view';

const flush = () => new Promise((r) => setTimeout(r));

async function render() {
  TestBed.configureTestingModule({
    imports: [LibraryView],
    providers: [{ provide: LibraryApi, useClass: FakeLibraryApi }],
  });
  const fixture = TestBed.createComponent(LibraryView);
  const api = TestBed.inject(LibraryApi) as FakeLibraryApi;
  await fixture.whenStable();
  await flush();
  return { fixture, api, el: fixture.nativeElement as HTMLElement };
}

describe('LibraryView', () => {
  it('shows the books of the default folder', async () => {
    const { fixture, api, el } = await render();
    api.pending[0].resolve(libraryScan('/home/test/Comics', ['Asterix 1.cbz', 'Asterix 2.cbz']));
    await flush();
    await fixture.whenStable();
    expect((el.querySelector('#library-folder') as HTMLInputElement).value).toBe(
      '/home/test/Comics',
    );
    expect([...el.querySelectorAll('.book .name')].map((n) => n.textContent?.trim())).toEqual([
      'Asterix 1.cbz',
      'Asterix 2.cbz',
    ]);
    expect(el.querySelector('[role=status]')?.textContent).toContain('2 books');
  });

  it('shows an error text, not the backend message', async () => {
    const { fixture, api, el } = await render();
    api.pending[0].reject({ code: 'permission_denied', message: 'EACCES /secret' });
    await flush();
    await fixture.whenStable();
    const status = el.querySelector('[role=status]')?.textContent ?? '';
    expect(status).toContain('Access denied');
    expect(status).not.toContain('EACCES');
  });

  it('renders at most MAX_LIST_ROWS rows', async () => {
    const { fixture, api, el } = await render();
    const names = Array.from({ length: MAX_LIST_ROWS + 3 }, (_, i) => `b${i}.cbz`);
    api.pending[0].resolve(libraryScan('/x', names));
    await flush();
    await fixture.whenStable();
    expect(el.querySelectorAll('.book').length).toBe(MAX_LIST_ROWS);
    expect(el.textContent).toContain('and 3 more');
  });

  it('scans the typed folder on submit', async () => {
    const { fixture, api, el } = await render();
    api.pending[0].resolve(libraryScan('/home/test/Comics', []));
    await flush();
    await fixture.whenStable();
    const input = el.querySelector('#library-folder') as HTMLInputElement;
    input.value = '/other';
    el.querySelector('form')?.dispatchEvent(new Event('submit'));
    expect(api.pending.map((p) => p.root)).toEqual(['/home/test/Comics', '/other']);
  });
});
