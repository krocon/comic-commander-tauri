import {
  computed,
  DestroyRef,
  effect,
  inject,
  Injectable,
  InjectionToken,
  signal,
  untracked,
} from '@angular/core';
import { FsError, toFsError } from '../../core/errors/fs-error';
import { ReaderApi } from '../../core/reader/reader-api';
import { PageInfo, ReaderEvent } from '../../core/reader/reader.models';
import { BookEntry } from '../../core/scan/scan.models';
import { VIEW_STATE_STORE } from '../grid/grid.store';
import {
  clampFactor,
  FitMode,
  nextZoom,
  ReaderMode,
  rotate,
  Rotation,
  startPage,
  toRotation,
  Zoom,
  zoomStep,
} from './reader-logic';
import { loadReaderSettings, saveReaderSettings } from './reader-settings';
import { READER_TEXTS } from './reader-texts';
import { ReaderService } from './reader.service';

/** Pause between the last page turn and saving the position (tests set it small). */
export const SAVE_DELAY_MS = new InjectionToken<number>('SAVE_DELAY_MS', { factory: () => 600 });
/** Least pause between two announcements of the live region. */
export const ANNOUNCE_MS = new InjectionToken<number>('ANNOUNCE_MS', { factory: () => 400 });

export type ReaderPhase = 'loading' | 'ready' | 'failed';
export type PageSize = { width: number; height: number } | null;

/**
 * State of one reader (design 005), next to the `Reader` component: the open book (token,
 * pages, sizes), the page, the settings, saving the position. Opens the book of the
 * `ReaderService` session and follows it (`]` / `[`); answers for a book that is no longer
 * wanted are dropped and that book is closed again (stale requests, CLAUDE.md §4).
 */
@Injectable()
export class ReaderStore {
  private readonly api = inject(ReaderApi);
  private readonly service = inject(ReaderService);
  private readonly settingsStore = inject(VIEW_STATE_STORE);
  private readonly saveDelay = inject(SAVE_DELAY_MS);
  private readonly announceMs = inject(ANNOUNCE_MS);
  private readonly t = READER_TEXTS;

  readonly book = computed<BookEntry | null>(() => {
    const s = this.service.session();
    return s ? (s.books[s.index] ?? null) : null;
  });
  readonly phase = signal<ReaderPhase>('loading');
  readonly error = signal<FsError | null>(null);
  readonly token = signal<string | null>(null);
  readonly pages = signal<PageInfo[]>([]);
  /** Size per page, as far as known (from Rust or the loaded image). */
  readonly sizes = signal<PageSize[]>([]);
  readonly page = signal(0);
  /** 7z / solid RAR: pages come while the book is unpacked. */
  readonly extracting = signal(false);
  /** The background pass broke off (pages after it fail). */
  readonly passError = signal<FsError | null>(null);
  readonly pageCount = computed(() => this.pages().length);

  private readonly initial = loadReaderSettings(this.settingsStore);
  readonly mode = signal<ReaderMode>(this.initial.mode);
  readonly zoom = signal<Zoom>(this.initial.zoom);
  /** The setting „right to left“ (all books). */
  readonly rtlSetting = signal(this.initial.rtl);
  /** The book says it reads right to left (ComicInfo `YesAndRightToLeft`, design 011 E11). */
  readonly bookRtl = computed(() => this.book()?.meta?.manga === 'rtl');
  /** `M` on such a book: for this book only, not saved. */
  private readonly rtlOverride = signal<boolean | null>(null);
  /** The reading direction in force. */
  readonly rtl = computed(() => this.rtlOverride() ?? (this.bookRtl() || this.rtlSetting()));
  readonly zoomSlider = signal(this.initial.zoomSlider);
  readonly toolbarPinned = signal(this.initial.toolbarPinned);
  /** Rotation of the open book (design 014 E5/E8: per book, in the reading state). */
  readonly rotation = signal<Rotation>(0);
  readonly fullscreen = signal(false);

  /** Text of the live region (throttled). */
  readonly announcement = signal('');
  /** Short note (first / last book of the list). */
  readonly notice = signal<string | null>(null);

  private seq = 0;
  /** One `open` at a time: quick `]` presses must not open (and evict) books nobody waits for
   *  (review 005 #2). */
  private queue: Promise<void> = Promise.resolve();
  private current: {
    categoryId: string;
    bookId: string;
    pages: number;
    saved: number;
    savedRotation: Rotation;
  } | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private announceTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingAnnouncement: string | null = null;

  constructor() {
    effect(() => {
      const book = this.book();
      const categoryId = untracked(this.service.session)?.categoryId ?? '';
      untracked(() => {
        this.rtlOverride.set(null);
        void this.load(categoryId, book);
      });
    });
    effect(() => {
      const s = {
        mode: this.mode(),
        zoom: this.zoom(),
        rtl: this.rtlSetting(),
        zoomSlider: this.zoomSlider(),
        toolbarPinned: this.toolbarPinned(),
      };
      untracked(() => saveReaderSettings(s, this.settingsStore));
    });
    inject(DestroyRef).onDestroy(() => {
      this.seq++;
      this.saveNow();
      this.closeToken();
      clearTimeout(this.announceTimer);
    });
  }

  private closeToken(): void {
    const token = this.token();
    if (token) void this.api.close(token).catch(() => undefined);
    this.token.set(null);
  }

  private async load(categoryId: string, book: BookEntry | null): Promise<void> {
    this.saveNow();
    this.closeToken();
    const seq = ++this.seq;
    this.current = null;
    this.phase.set('loading');
    this.error.set(null);
    this.passError.set(null);
    this.pages.set([]);
    this.sizes.set([]);
    this.page.set(0);
    this.rotation.set(0);
    if (!book) return;
    const run = () => this.openBook(seq, categoryId, book);
    this.queue = this.queue.then(run, run);
    await this.queue;
  }

  private async openBook(seq: number, categoryId: string, book: BookEntry): Promise<void> {
    // a newer book was asked for while waiting: this one is never opened
    if (seq !== this.seq) return;
    try {
      const opened = await this.api.open(categoryId, book.id, (e) => {
        if (seq === this.seq) this.onEvent(e);
      });
      if (seq !== this.seq) {
        void this.api.close(opened.token).catch(() => undefined);
        return;
      }
      const n = opened.pages.length;
      const start = startPage(opened.lastPage, n);
      this.token.set(opened.token);
      this.pages.set(opened.pages);
      this.sizes.update((known) =>
        opened.pages.map((p, i) =>
          p.width && p.height ? { width: p.width, height: p.height } : (known[i] ?? null),
        ),
      );
      this.extracting.set(opened.extracting);
      const rotation = toRotation(opened.rotation);
      this.page.set(start);
      this.rotation.set(rotation);
      this.current = {
        categoryId,
        bookId: book.id,
        pages: n,
        saved: start,
        savedRotation: rotation,
      };
      this.phase.set('ready');
      this.announce(this.t.page(start + 1, n));
    } catch (e) {
      if (seq !== this.seq) return;
      this.error.set(toFsError(e));
      this.phase.set('failed');
    }
  }

  private onEvent(e: ReaderEvent): void {
    switch (e.kind) {
      case 'dims': {
        // may come before `open` answered: keep them for the pages to come
        this.sizes.update((s) => {
          const next = [...s];
          for (const d of e.pages) {
            if (d.width > 0 && d.height > 0) next[d.index] = { width: d.width, height: d.height };
          }
          return next;
        });
        return;
      }
      case 'failed':
        this.passError.set(e.error);
        return;
      case 'done':
        return;
    }
  }

  /** The size of a loaded image (when Rust did not know it). */
  setSize(index: number, width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    const known = this.sizes()[index];
    if (known && known.width === width && known.height === height) return;
    this.sizes.update((s) => {
      const next = [...s];
      next[index] = { width, height };
      return next;
    });
  }

  goTo(index: number): void {
    const n = this.pageCount();
    if (n === 0) return;
    const i = Math.min(n - 1, Math.max(0, Math.round(index)));
    if (i === this.page()) return;
    this.page.set(i);
    this.announce(this.t.page(i + 1, n));
    this.saveSoon();
  }

  private saveSoon(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveNow(), this.saveDelay);
  }

  /** One page on; `false` on the last page. */
  next(): boolean {
    if (this.page() >= this.pageCount() - 1) return false;
    this.goTo(this.page() + 1);
    return true;
  }

  prev(): boolean {
    if (this.page() <= 0) return false;
    this.goTo(this.page() - 1);
    return true;
  }

  first(): void {
    this.goTo(0);
  }

  last(): void {
    this.goTo(this.pageCount() - 1);
  }

  nextBook(): void {
    this.notice.set(this.service.move(1) ? null : this.t.lastOfList);
  }

  prevBook(): void {
    this.notice.set(this.service.move(-1) ? null : this.t.firstOfList);
  }

  toggleMode(): void {
    this.mode.update((m) => (m === 'single' ? 'continuous' : 'single'));
  }

  // ---- zoom and rotation (design 014) ------------------------------------------------------

  private zoomLabel(mode: FitMode): string {
    const t = this.t;
    return { width: t.fitWidth, height: t.fitHeight, page: t.fitPage, full: t.fullSize }[mode];
  }

  setZoomMode(mode: FitMode): void {
    this.zoom.update((z) => ({ mode, factor: z.factor }));
    this.announce(this.t.zoomIs(this.zoomLabel(mode)));
  }

  /** `W` / `Shift+W`: the next / previous fit. */
  cycleZoom(dir: 1 | -1): void {
    this.setZoomMode(nextZoom(this.zoom(), dir).mode as FitMode);
  }

  /** A free factor (slider, wheel, `+` / `-`) – the mode becomes `custom` (E6). */
  setFactor(factor: number): void {
    this.zoom.set({ mode: 'custom', factor: clampFactor(factor) });
  }

  /** One step from the effective factor of the page shown. */
  zoomBy(dir: 1 | -1, effective: number): void {
    const f = zoomStep(effective, dir);
    this.setFactor(f);
    this.announce(this.t.zoomIs(this.t.percent(Math.round(f * 100))));
  }

  rotate(dir: 1 | -1): void {
    if (this.phase() !== 'ready') return;
    const r = rotate(this.rotation(), dir);
    this.rotation.set(r);
    this.announce(this.t.rotated(r));
    this.saveSoon();
  }

  toggleZoomSlider(): void {
    this.zoomSlider.update((v) => !v);
  }

  toggleToolbar(): void {
    this.toolbarPinned.update((v) => !v);
  }

  /** A text for the live region (throttled with the page announcements). */
  say(text: string): void {
    this.announce(text);
  }

  /** A book that reads right to left by its ComicInfo is switched alone; else the setting. */
  toggleRtl(): void {
    if (this.bookRtl()) this.rtlOverride.set(!this.rtl());
    else this.rtlSetting.update((r) => !r);
  }

  async toggleFullscreen(): Promise<void> {
    try {
      this.fullscreen.set(await this.api.toggleFullscreen());
    } catch {
      // not available (browser): nothing to do
    }
  }

  /** Leaves full screen first (Esc), else closes the reader. */
  async escape(): Promise<void> {
    if (this.fullscreen()) {
      await this.toggleFullscreen();
      return;
    }
    this.close();
  }

  close(): void {
    if (this.fullscreen()) void this.toggleFullscreen();
    this.service.close();
  }

  pageUrl(index: number, width: number, retry = 0): string | null {
    const token = this.token();
    return token ? this.api.pageUrl(token, index, width, retry) : null;
  }

  /** Writes the position now (book switch, close) – only when it changed. */
  saveNow(): void {
    clearTimeout(this.saveTimer);
    const c = this.current;
    if (!c || this.phase() !== 'ready') return;
    const page = this.page();
    const rotation = this.rotation();
    if (page === c.saved && rotation === c.savedRotation) return;
    c.saved = page;
    c.savedRotation = rotation;
    this.service.remember(c.bookId, page, c.pages, rotation);
    void this.api
      .savePosition(c.categoryId, c.bookId, page, c.pages, rotation)
      .catch(() => undefined);
  }

  /** Live region: at most one text per `ANNOUNCE_MS`, the last one wins. */
  private announce(text: string): void {
    if (this.announceTimer !== undefined) {
      this.pendingAnnouncement = text;
      return;
    }
    this.announcement.set(text);
    const tick = () => {
      const pending = this.pendingAnnouncement;
      this.pendingAnnouncement = null;
      if (pending !== null) {
        this.announcement.set(pending);
        this.announceTimer = setTimeout(tick, this.announceMs);
      } else {
        this.announceTimer = undefined;
      }
    };
    this.announceTimer = setTimeout(tick, this.announceMs);
  }
}
