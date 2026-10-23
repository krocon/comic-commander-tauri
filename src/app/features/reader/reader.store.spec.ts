import { TestBed } from '@angular/core/testing';
import { ReaderApi } from '../../core/reader/reader-api';
import { books } from '../../../testing/fixtures';
import { FakeReaderApi, pagesBook } from '../../../testing/fake-reader-api';
import { VIEW_STATE_STORE } from '../grid/grid.store';
import { KeyValueStore } from '../grid/view-state';
import { ANNOUNCE_MS, ReaderStore, SAVE_DELAY_MS } from './reader.store';
import { ReaderService } from './reader.service';

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));

function setup() {
  const data = new Map<string, string>();
  const kv: KeyValueStore = {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
  TestBed.configureTestingModule({
    providers: [
      ReaderStore,
      { provide: ReaderApi, useClass: FakeReaderApi },
      { provide: VIEW_STATE_STORE, useValue: kv },
      { provide: SAVE_DELAY_MS, useValue: 1 },
      { provide: ANNOUNCE_MS, useValue: 1 },
    ],
  });
  const api = TestBed.inject(ReaderApi) as FakeReaderApi;
  const service = TestBed.inject(ReaderService);
  const list = books('Hägar 01 🦸.cbz', 'Hägar 02.cbz', 'Hägar 03.cbz');
  return { api, service, list, data };
}

async function opened(s: ReturnType<typeof setup>, index = 0) {
  s.service.open('c1', s.list, index);
  const store = TestBed.inject(ReaderStore);
  TestBed.tick();
  await wait();
  return store;
}

describe('ReaderStore', () => {
  it('opens the book of the session at the remembered page', async () => {
    const s = setup();
    s.api.books.set(s.list[0].id, pagesBook(48, 'tok1', { lastPage: 11 }));
    const store = await opened(s);
    expect(s.api.calls).toEqual([`open c1.${s.list[0].id}`]);
    expect(store.phase()).toBe('ready');
    expect(store.pageCount()).toBe(48);
    expect(store.page()).toBe(11);
    expect(store.pageUrl(11, 2048)).toBe('page:tok1/11/2048');
    expect(store.announcement()).toBe('Page 12 of 48');
  });

  it('turns pages within the book and saves the position debounced, once', async () => {
    const s = setup();
    s.api.books.set(s.list[0].id, pagesBook(3, 'tok1'));
    const store = await opened(s);
    expect(store.prev()).toBe(false);
    expect(store.next()).toBe(true);
    expect(store.next()).toBe(true);
    expect(store.next()).toBe(false);
    expect(store.page()).toBe(2);
    await wait(5);
    expect(s.api.calls.filter((c) => c.startsWith('save'))).toEqual([
      `save c1.${s.list[0].id} 2/3`,
    ]);
    expect(s.service.positions()[s.list[0].id]).toMatchObject({ page: 2, pages: 3 });
    store.saveNow();
    expect(s.api.calls.filter((c) => c.startsWith('save')).length).toBe(1);
    store.first();
    expect(store.page()).toBe(0);
    store.goTo(99);
    expect(store.page()).toBe(2);
  });

  it('does not save a position that did not change', async () => {
    const s = setup();
    const store = await opened(s);
    store.saveNow();
    expect(s.api.calls.some((c) => c.startsWith('save'))).toBe(false);
  });

  it('follows the session to the next book, closes the old one, saves its page', async () => {
    const s = setup();
    s.api.books.set(s.list[0].id, pagesBook(5, 'tok1'));
    s.api.books.set(s.list[1].id, pagesBook(7, 'tok2'));
    const store = await opened(s);
    store.goTo(3);
    store.nextBook();
    TestBed.tick();
    await wait();
    expect(s.api.calls).toContain(`save c1.${s.list[0].id} 3/5`);
    expect(s.api.calls).toContain('close tok1');
    expect(store.token()).toBe('tok2');
    expect(store.pageCount()).toBe(7);
    expect(store.page()).toBe(0);
    store.prevBook();
    store.prevBook();
    expect(store.notice()).toBe('This is the first book of the list.');
  });

  it('drops a stale answer and closes that book again', async () => {
    const s = setup();
    s.api.books.set(s.list[0].id, pagesBook(5, 'slow'));
    s.api.books.set(s.list[1].id, pagesBook(6, 'fast'));
    s.api.hold = true;
    s.service.open('c1', s.list, 0);
    const store = TestBed.inject(ReaderStore);
    TestBed.tick();
    await wait(); // the first open is in flight
    s.service.move(1);
    TestBed.tick();
    await wait();
    s.api.release();
    await wait();
    // one open at a time: the second waits for the first
    s.api.release();
    await wait();
    expect(store.token()).toBe('fast');
    expect(s.api.calls).toContain('close slow');
  });

  it('never opens a book that was skipped while another one was opening (review 005 #2)', async () => {
    const s = setup();
    s.api.hold = true;
    s.service.open('c1', s.list, 0);
    const store = TestBed.inject(ReaderStore);
    TestBed.tick();
    await wait(); // the first open is in flight
    s.service.move(1);
    TestBed.tick();
    s.service.move(1);
    TestBed.tick();
    await wait();
    s.api.release();
    await wait();
    s.api.release();
    await wait();
    const opens = s.api.calls.filter((c) => c.startsWith('open'));
    expect(opens).toEqual([`open c1.${s.list[0].id}`, `open c1.${s.list[2].id}`]);
    expect(store.phase()).toBe('ready');
  });

  it('takes sizes from events and loaded images, even before the answer', async () => {
    const s = setup();
    s.api.books.set(s.list[0].id, pagesBook(3, 'tok1'));
    s.api.hold = true;
    s.service.open('c1', s.list, 0);
    const store = TestBed.inject(ReaderStore);
    TestBed.tick();
    await wait();
    s.api.emit({ kind: 'dims', pages: [{ index: 1, width: 100, height: 150 }] });
    s.api.release();
    await wait();
    expect(store.sizes()).toEqual([null, { width: 100, height: 150 }, null]);
    store.setSize(2, 300, 200);
    expect(store.sizes()[2]).toEqual({ width: 300, height: 200 });
    s.api.emit({ kind: 'failed', error: { code: 'archive_error', message: 'x' } });
    expect(store.passError()?.code).toBe('archive_error');
  });

  it('shows a book that cannot be opened as failed', async () => {
    const s = setup();
    s.api.books.set(s.list[0].id, { code: 'archive_encrypted', message: 'x' });
    const store = await opened(s);
    expect(store.phase()).toBe('failed');
    expect(store.error()?.code).toBe('archive_encrypted');
  });

  it('remembers the settings and handles full screen before closing', async () => {
    const s = setup();
    const store = await opened(s);
    store.toggleMode();
    store.setZoomMode('page');
    store.toggleRtl();
    store.toggleZoomSlider();
    store.toggleToolbar();
    TestBed.tick();
    expect(JSON.parse(s.data.get('cc.reader')!)).toEqual({
      v: 1,
      mode: 'continuous',
      zoom: { mode: 'page', factor: 1 },
      rtl: true,
      zoomSlider: true,
      toolbarPinned: true,
    });
    await store.toggleFullscreen();
    expect(store.fullscreen()).toBe(true);
    await store.escape();
    expect(store.fullscreen()).toBe(false);
    expect(s.service.session()).not.toBeNull();
    await store.escape();
    expect(s.service.session()).toBeNull();
  });

  it('closes its book when destroyed', async () => {
    const s = setup();
    s.api.books.set(s.list[0].id, pagesBook(4, 'tok1'));
    const store = await opened(s);
    store.goTo(2);
    TestBed.resetTestingModule();
    expect(s.api.calls).toContain('close tok1');
    expect(s.api.calls).toContain(`save c1.${s.list[0].id} 2/4`);
  });

  it('chooses, cycles and frees the zoom (design 014)', async () => {
    const s = setup();
    const store = await opened(s);
    expect(store.zoom()).toEqual({ mode: 'width', factor: 1 });
    store.cycleZoom(1);
    expect(store.zoom().mode).toBe('height');
    store.cycleZoom(-1);
    store.cycleZoom(-1);
    expect(store.zoom().mode).toBe('full');
    await wait(5);
    expect(store.announcement()).toBe('Zoom: Full size');
    store.setFactor(2.4);
    expect(store.zoom()).toEqual({ mode: 'custom', factor: 2.4 });
    store.setFactor(50);
    expect(store.zoom().factor).toBe(8);
    // + / - step from the effective factor of the page shown
    store.zoomBy(1, 0.37);
    expect(store.zoom()).toEqual({ mode: 'custom', factor: 0.5 });
    store.setZoomMode('page');
    expect(store.zoom().mode).toBe('page');
  });

  it('turns the book, remembers it with the position and opens it turned', async () => {
    const s = setup();
    s.api.books.set(s.list[0].id, pagesBook(4, 'tok1', { rotation: 270 }));
    s.api.books.set(s.list[1].id, pagesBook(4, 'tok2'));
    const store = await opened(s);
    expect(store.rotation()).toBe(270);
    store.rotate(1);
    expect(store.rotation()).toBe(0);
    store.rotate(1);
    expect(store.rotation()).toBe(90);
    await wait(5);
    // saved without a page turn, once
    expect(s.api.calls.filter((c) => c.startsWith('save'))).toEqual([
      `save c1.${s.list[0].id} 0/4 r90`,
    ]);
    expect(store.announcement()).toBe('Rotated 90°');
    expect(s.service.positions()[s.list[0].id].rotation).toBe(90);
    // the next book has its own rotation
    store.nextBook();
    TestBed.tick();
    await wait();
    expect(store.rotation()).toBe(0);
  });

  it('a book with ComicInfo „YesAndRightToLeft“ reads right to left; M switches it alone (011 E11)', async () => {
    const s = setup();
    s.list[1] = { ...s.list[1], meta: { manga: 'rtl' } };
    const store = await opened(s);
    expect(store.rtl()).toBe(false);
    s.service.move(1);
    TestBed.tick();
    await wait();
    expect(store.bookRtl()).toBe(true);
    expect(store.rtl()).toBe(true);
    store.toggleRtl();
    expect(store.rtl()).toBe(false);
    expect(store.rtlSetting()).toBe(false);
    TestBed.tick();
    expect(JSON.parse(s.data.get('cc.reader') ?? '{"rtl":false}').rtl).toBe(false);
    // the next book: the setting again, the override is gone
    s.service.move(1);
    TestBed.tick();
    await wait();
    expect(store.rtl()).toBe(false);
    s.service.move(-1);
    TestBed.tick();
    await wait();
    expect(store.rtl()).toBe(true);
  });
});
