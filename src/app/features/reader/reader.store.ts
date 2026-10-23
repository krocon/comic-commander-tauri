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
import { ReaderFit, ReaderMode, startPage } from './reader-logic';
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
  readonly fit = signal<ReaderFit>(this.initial.fit);
  readonly rtl = signal(this.initial.rtl);
  readonly fullscreen = signal(false);

  /** Text of the live region (throttled). */
  readonly announcement = signal('');
  /** Short note (first / last book of the list). */
  readonly notice = signal<string | null>(null);

  private seq = 0;
  private current: { categoryId: string; bookId: string; pages: number; saved: number } | null =
    null;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private announceTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingAnnouncement: string | null = null;

  constructor() {
    effect(() => {
      const book = this.book();
      const categoryId = untracked(this.service.session)?.categoryId ?? '';
      untracked(() => void this.load(categoryId, book));
    });
    effect(() => {
      const s = { mode: this.mode(), fit: this.fit(), rtl: this.rtl() };
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
    if (!book) return;
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
      this.page.set(start);
      this.current = { categoryId, bookId: book.id, pages: n, saved: start };
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

  toggleFit(): void {
    this.fit.update((f) => (f === 'width' ? 'height' : 'width'));
  }

  toggleRtl(): void {
    this.rtl.update((r) => !r);
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
    if (page === c.saved) return;
    c.saved = page;
    this.service.remember(c.bookId, page, c.pages);
    void this.api.savePosition(c.categoryId, c.bookId, page, c.pages).catch(() => undefined);
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
