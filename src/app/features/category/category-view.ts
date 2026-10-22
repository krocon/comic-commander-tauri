import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  InjectionToken,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { describeFsError } from '../../core/errors/fs-error';
import { DialogService } from '../../shared/dialog/dialog.service';
import { CoversApi } from '../../core/covers/covers-api';
import { BookEntry } from '../../core/scan/scan.models';
import { CategoriesStore } from '../categories/categories.store';
import { CategoryMenu } from './category-menu';
import { CategoryStore } from './category.store';
import { CATEGORY_TEXTS } from './category-texts';

/** Rows of the plain list (the cover grid of prompt 004 virtualises). */
export const MAX_LIST_ROWS = 500;

/** How often a failed cover is asked for again (review 003 #4). */
export const COVER_RETRIES = 2;
/** Pause before the n-th retry: n × this (tests set it small). */
export const COVER_RETRY_MS = new InjectionToken<number>('COVER_RETRY_MS', {
  factory: () => 2000,
});

/**
 * The active category (design 002): toolbar with the category menu, „scan again“, status; the
 * list of books (→ cover grid in 004); the first-start screen. Scans again whenever the
 * active category, its folder or its file types change. Keys: `Mod+R` scan again,
 * `Mod+1…9` choose a category.
 */
@Component({
  selector: 'app-category-view',
  imports: [CategoryMenu],
  templateUrl: './category-view.html',
  styleUrl: './category-view.css',
  providers: [CategoryStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKeydown($event)' },
})
export class CategoryView {
  protected readonly categories = inject(CategoriesStore);
  protected readonly store = inject(CategoryStore);
  private readonly dialogs = inject(DialogService);
  private readonly covers = inject(CoversApi);
  private readonly retryMs = inject(COVER_RETRY_MS);
  /** Failed loads per cover URL (a changed book has a new URL and a fresh chance). */
  private readonly coverFailures = signal<ReadonlyMap<string, number>>(new Map());
  /** Cover URLs waiting for their next try: the format shows meanwhile. */
  private readonly coverWaiting = signal<ReadonlySet<string>>(new Set());
  private readonly retryTimers = new Set<ReturnType<typeof setTimeout>>();
  protected readonly t = CATEGORY_TEXTS;

  /** Ticks every 30 s for „updated 3 min ago“. */
  private readonly now = signal(Date.now());

  /** What is scanned: a change starts a new scan (design 002). */
  private readonly scanKey = computed(() => {
    if (!this.categories.loaded()) return null;
    const c = this.categories.active();
    return c ? [c.id, c.baseDir, ...c.bookExtensions].join('\u0000') : '';
  });

  protected readonly shown = computed(() => this.store.books().slice(0, MAX_LIST_ROWS));
  protected readonly hidden = computed(() =>
    Math.max(0, this.store.books().length - MAX_LIST_ROWS),
  );

  protected readonly status = computed(() => {
    const s = this.store;
    const t = this.t;
    switch (s.phase()) {
      case 'idle':
        return '';
      case 'scanning': {
        if (s.fromCache() && s.scannedAt() !== null) {
          return `${t.books(s.books().length)} · ${t.updated(s.scannedAt()!, this.now())} · ${t.refreshing}`;
        }
        const p = s.progress();
        return t.scanning(p?.books ?? s.books().length, p?.dirs ?? 0);
      }
      case 'done': {
        const parts = [t.books(s.books().length)];
        if (s.scannedAt() !== null) parts.push(t.updated(s.scannedAt()!, this.now()));
        const st = s.stats();
        if (st?.unreadableDirs) parts.push(t.unreadableDirs(st.unreadableDirs));
        if (st?.skippedDirLinks) parts.push(t.skippedDirLinks(st.skippedDirLinks));
        return parts.join(' · ');
      }
      case 'cancelled':
        return t.cancelled(s.books().length);
      case 'failed': {
        if (s.cacheKept() && s.scannedAt() !== null) return t.unreachable(s.scannedAt()!);
        const e = s.error();
        return e ? describeFsError(e) : '';
      }
    }
  });
  protected readonly warn = computed(() => this.store.phase() === 'failed');

  protected readonly categoriesError = computed(() => {
    const e = this.categories.error();
    return e ? describeFsError(e) : '';
  });

  constructor() {
    effect(() => {
      const key = this.scanKey();
      if (key === null) return;
      untracked(() => void this.store.open(this.categories.active()?.id ?? null));
    });
    const timer = setInterval(() => this.now.set(Date.now()), 30_000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      this.retryTimers.forEach(clearTimeout);
    });
  }

  /** Smallest size of the category (`thumbsDims[0]`) – the list shows 32 × 48 px. */
  private coverUrl(book: BookEntry): string | null {
    const c = this.categories.active();
    return c ? this.covers.coverUrl(c.id, book, 0) : null;
  }

  /**
   * `src` of the cover, `null` = show the format. A failed cover is asked for again after a
   * pause (busy pool → 503, a sleeping NAS), [COVER_RETRIES] times; `retry=` makes the
   * WebView load it again (errors are `no-store` anyway).
   */
  protected coverSrc(book: BookEntry): string | null {
    const url = this.coverUrl(book);
    if (url === null || this.coverWaiting().has(url)) return null;
    const failed = this.coverFailures().get(url) ?? 0;
    if (failed > COVER_RETRIES) return null;
    return failed ? `${url}${url.includes('?') ? '&' : '?'}retry=${failed}` : url;
  }

  protected coverFailed(book: BookEntry): void {
    const url = this.coverUrl(book);
    if (url === null) return;
    const failed = (this.coverFailures().get(url) ?? 0) + 1;
    this.coverFailures.update((m) => new Map(m).set(url, failed));
    if (failed > COVER_RETRIES) return;
    this.coverWaiting.update((s) => new Set(s).add(url));
    const timer = setTimeout(() => {
      this.retryTimers.delete(timer);
      this.coverWaiting.update((s) => {
        const next = new Set(s);
        next.delete(url);
        return next;
      });
    }, this.retryMs * failed);
    this.retryTimers.add(timer);
  }

  protected rescan(): void {
    if (this.categories.active() && !this.store.scanning()) void this.store.rescan();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (this.dialogs.open() !== null || event.altKey || event.shiftKey) return;
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      this.rescan();
      return;
    }
    const n = Number(event.key);
    if (Number.isInteger(n) && n >= 1 && n <= 9) {
      const c = this.categories.categories()[n - 1];
      if (c) {
        event.preventDefault();
        void this.categories.select(c.id);
      }
    }
  }
}
