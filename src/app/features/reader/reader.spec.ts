import { TestBed } from '@angular/core/testing';
import { BooksApi } from '../../core/books/books-api';
import { ReaderApi } from '../../core/reader/reader-api';
import { FakeBooksApi } from '../../../testing/fake-books-api';
import { FakeReaderApi, pagesBook } from '../../../testing/fake-reader-api';
import { books } from '../../../testing/fixtures';
import { VIEW_STATE_STORE } from '../grid/grid.store';
import { BAR_IDLE_MS, PAGE_RETRY_MS, Reader } from './reader';
import { ANNOUNCE_MS, SAVE_DELAY_MS } from './reader.store';
import { ReaderService } from './reader.service';
import { wireKeyboard } from '../../../testing/keyboard';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function setup(
  answer?: ReturnType<typeof pagesBook> | { code: 'archive_error'; message: string },
) {
  const data = new Map<string, string>();
  TestBed.configureTestingModule({
    providers: [
      { provide: ReaderApi, useClass: FakeReaderApi },
      { provide: BooksApi, useClass: FakeBooksApi },
      {
        provide: VIEW_STATE_STORE,
        useValue: {
          getItem: (k: string) => data.get(k) ?? null,
          setItem: (k: string, v: string) => void data.set(k, v),
        },
      },
      { provide: SAVE_DELAY_MS, useValue: 1 },
      { provide: ANNOUNCE_MS, useValue: 1 },
      { provide: PAGE_RETRY_MS, useValue: 1 },
      { provide: BAR_IDLE_MS, useValue: 10_000 },
    ],
  });
  const api = TestBed.inject(ReaderApi) as FakeReaderApi;
  const list = books('Hägar 01 🦸.cbz', 'Hägar 02.cbz');
  api.books.set(list[0].id, answer ?? pagesBook(10, 'tok1'));
  const service = TestBed.inject(ReaderService);
  service.open('c1', list, 0);
  cleanups.push(wireKeyboard());
  const fixture = TestBed.createComponent(Reader);
  document.body.appendChild(fixture.nativeElement);
  cleanups.push(() => fixture.nativeElement.remove());
  fixture.detectChanges();
  await wait();
  await fixture.whenStable();
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const root = el.querySelector('.reader') as HTMLElement;
  const press = async (key: string, init: KeyboardEventInit = {}, target: Element = root) => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    );
    await wait();
    fixture.detectChanges();
  };
  return {
    fixture,
    el,
    root,
    api,
    service,
    list,
    press,
    books: TestBed.inject(BooksApi) as FakeBooksApi,
  };
}

describe('Reader', () => {
  it('is a dialog that shows the page with its number', async () => {
    const { el, root } = await setup();
    expect(root.getAttribute('role')).toBe('dialog');
    expect(root.getAttribute('aria-modal')).toBe('true');
    expect(root.getAttribute('aria-label')).toBe('Reader: Hägar 01 🦸.cbz');
    const img = el.querySelector('.view.single img') as HTMLImageElement;
    expect(img.getAttribute('src')).toMatch(/^page:tok1\/0\//);
    expect(img.alt).toBe('Page 1 of 10');
    expect(el.querySelector('.count')!.textContent!.trim()).toBe('1 / 10');
    expect(el.querySelector('[aria-live]')!.textContent).toBe('Page 1 of 10');
    for (const b of Array.from(el.querySelectorAll('button'))) {
      expect(b.getAttribute('aria-label') || b.textContent!.trim()).toBeTruthy();
    }
  });

  it('turns pages with the keys, mirrored for manga', async () => {
    const { el, press } = await setup();
    const page = () => (el.querySelector('.view.single img') as HTMLImageElement).alt;
    await press('ArrowRight');
    await press(' ');
    expect(page()).toBe('Page 3 of 10');
    await press('b');
    expect(page()).toBe('Page 2 of 10');
    await press('End');
    expect(page()).toBe('Page 10 of 10');
    await press('ArrowLeft', { ctrlKey: true });
    expect(page()).toBe('Page 1 of 10');
    await press('m');
    await press('ArrowLeft');
    expect(page()).toBe('Page 2 of 10');
    expect(
      el.querySelector('[aria-pressed="true"][aria-label="Right to left (M)"]'),
    ).not.toBeNull();
  });

  it('leaves the slider its own arrow keys and jumps with it', async () => {
    const { el, press, fixture } = await setup();
    const slider = el.querySelector('input[type=range]') as HTMLInputElement;
    await press('ArrowRight', {}, slider);
    expect((el.querySelector('.view.single img') as HTMLImageElement).alt).toBe('Page 1 of 10');
    slider.value = '7';
    slider.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect((el.querySelector('.view.single img') as HTMLImageElement).alt).toBe('Page 7 of 10');
  });

  it('switches to the continuous mode and back', async () => {
    const { el, press } = await setup();
    await press('s');
    expect(el.querySelector('.view.continuous .track')).not.toBeNull();
    await press('S');
    expect(el.querySelector('.view.single')).not.toBeNull();
  });

  it('goes to the next book and back to the grid', async () => {
    const { press, api, service, list } = await setup();
    await press(']');
    await wait();
    expect(api.calls).toContain(`open c1.${list[1].id}`);
    await press('Escape');
    expect(service.session()).toBeNull();
    expect(service.closedOn()).toEqual({ bookId: list[1].id });
  });

  it('retries a failed page, then offers to try again', async () => {
    const { el, fixture } = await setup();
    for (let i = 0; i < 3; i++) {
      el.querySelector('.view.single img')!.dispatchEvent(new Event('error'));
      await wait(5);
      fixture.detectChanges();
    }
    expect(el.querySelector('.view.single img')).toBeNull();
    const retry = el.querySelector('.page-failed button') as HTMLButtonElement;
    expect(el.querySelector('.page-failed')!.textContent).toContain('This page cannot be shown.');
    retry.click();
    fixture.detectChanges();
    expect(el.querySelector('.view.single img')!.getAttribute('src')).toContain('retry=3');
  });

  it('explains a book that cannot be read and offers the default app', async () => {
    const { el, books: booksApi, list } = await setup({ code: 'archive_error', message: 'x' });
    const alert = el.querySelector('[role=alert]')!;
    expect(alert.textContent).toContain('This book cannot be read.');
    expect(alert.textContent).not.toContain('x\n');
    (alert.querySelector('button') as HTMLButtonElement).click();
    expect(booksApi.calls).toEqual([`open c1.${list[0].id}`]);
  });
});
