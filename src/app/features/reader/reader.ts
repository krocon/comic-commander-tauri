import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  InjectionToken,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { BooksApi } from '../../core/books/books-api';
import { describeFsError } from '../../core/errors/fs-error';
import {
  anchorOf,
  Anchor,
  aspects,
  clickZone,
  currentPage,
  keyCommand,
  layoutPages,
  prefetchPages,
  ReaderCommand,
  scrollTopOf,
  step,
  swipe,
  visibleRange,
  widthBucket,
} from './reader-logic';
import { READER_TEXTS } from './reader-texts';
import { ReaderStore } from './reader.store';
import { ReaderService } from './reader.service';

/** Pause before a failed page is asked for again: n × this (tests set it small). */
export const PAGE_RETRY_MS = new InjectionToken<number>('PAGE_RETRY_MS', { factory: () => 1000 });
/** The toolbar hides after this long without the pointer moving. */
export const BAR_IDLE_MS = new InjectionToken<number>('BAR_IDLE_MS', { factory: () => 2500 });
/** Automatic retries of a page (503 when busy, a book still unpacking). */
const MAX_RETRIES = 2;

/**
 * The reader (design 005): a layer over the category view (E6) – single page (fit width or
 * height, first scroll then turn) or continuous (virtualised); keys, clicks into the outer
 * thirds, swipes; slider and „12 / 48“; next / previous book; full screen. A dialog for
 * assistive technology (`role="dialog"`, focus stays inside, page changes announced).
 * Keys in one handler on the layer (CLAUDE.md §4: no scattered handlers).
 */
@Component({
  selector: 'app-reader',
  templateUrl: './reader.html',
  styleUrl: './reader.css',
  providers: [ReaderStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // on the document: a re-rendered view (mode switch) must not lose the keys (E2E 005)
  host: { '(document:keydown)': 'onKeydown($event)' },
})
export class Reader {
  protected readonly store = inject(ReaderStore);
  private readonly books = inject(BooksApi);
  private readonly session = inject(ReaderService);
  private readonly retryMs = inject(PAGE_RETRY_MS);
  private readonly idleMs = inject(BAR_IDLE_MS);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly t = READER_TEXTS;

  private readonly root = viewChild<ElementRef<HTMLElement>>('root');
  private readonly view = viewChild<ElementRef<HTMLElement>>('view');

  private readonly viewWidth = signal(0);
  private readonly viewHeight = signal(0);
  private readonly scrollTop = signal(0);
  private readonly dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;

  /** Bar hidden (no pointer movement for a while, not hovered, no focus inside). */
  protected readonly idle = signal(false);
  private readonly overBar = signal(false);
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;

  /** Automatic retries per page; `failed` = given up (placeholder with „try again“). */
  protected readonly retries = signal<Record<number, number>>({});
  protected readonly failed = signal<Record<number, true>>({});
  private readonly retryTimers = new Set<ReturnType<typeof setTimeout>>();
  /** Images loaded ahead (kept so the requests are not dropped). */
  private prefetched: HTMLImageElement[] = [];

  /** Single mode: after turning back, show the end of the page. */
  private enterAtEnd = false;
  /** Continuous mode: where the reading is (kept when sizes change). */
  private anchor: Anchor | null = null;
  /** Continuous mode: scroll to the page once laid out (start, mode switch, slider). */
  private pendingJump: number | null = null;
  private pointer: { x: number; y: number } | null = null;
  private swiped = false;

  protected readonly width = computed(() =>
    widthBucket(this.viewWidth(), this.viewHeight(), this.dpr),
  );
  protected readonly bookName = computed(() => this.store.book()?.name ?? '');
  protected readonly errorText = computed(() => {
    const e = this.store.error();
    return e ? describeFsError(e) : '';
  });
  protected readonly pageLabel = computed(() =>
    this.t.page(this.store.page() + 1, this.store.pageCount()),
  );
  protected readonly ratio = computed(() => {
    const s = this.store.sizes()[this.store.page()];
    return s ? `${s.width} / ${s.height}` : null;
  });

  protected readonly layout = computed(() =>
    layoutPages(
      aspects(
        Array.from({ length: this.store.pageCount() }, (_, i) => this.store.sizes()[i] ?? null),
      ),
      this.viewWidth(),
      this.viewHeight(),
      this.store.fit(),
    ),
  );
  protected readonly visible = computed(() => {
    if (this.store.mode() !== 'continuous') return [];
    const l = this.layout();
    const [from, to] = visibleRange(
      l.boxes,
      this.scrollTop(),
      this.viewHeight(),
      this.viewHeight(),
    );
    const out: number[] = [];
    for (let i = from; i <= to && i < this.store.pageCount(); i++) out.push(i);
    return out;
  });

  constructor() {
    const el = this.host.nativeElement;
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => {
        const r = entries[0]?.contentRect;
        if (r) {
          this.viewWidth.set(Math.floor(r.width));
          this.viewHeight.set(Math.floor(r.height));
        }
      });
      ro.observe(el);
      inject(DestroyRef).onDestroy(() => ro.disconnect());
    }
    afterNextRender(() => {
      if (this.viewWidth() === 0) {
        this.viewWidth.set(el.clientWidth);
        this.viewHeight.set(el.clientHeight);
      }
      this.root()?.nativeElement.focus({ preventScroll: true });
    });
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.idleTimer);
      clearTimeout(this.noticeTimer);
      this.retryTimers.forEach((t) => clearTimeout(t));
      this.prefetched = [];
    });

    // a new book: fresh error state, the view at its start, focus into the page
    effect(() => {
      this.store.token();
      untracked(() => {
        // timers of the previous book must not spend this book's retries (review 005 #8)
        this.retryTimers.forEach((t) => clearTimeout(t));
        this.retryTimers.clear();
        this.retries.set({});
        this.failed.set({});
        this.anchor = null;
        this.pendingJump = this.store.page();
        this.enterAtEnd = false;
        if (this.store.phase() === 'ready') setTimeout(() => this.focusView());
      });
    });
    // single mode: a new page starts at its top (or its end after turning back)
    effect(() => {
      this.store.page();
      if (this.store.mode() !== 'single') return;
      untracked(() => requestAnimationFrame(() => this.placeSingle()));
    });
    // continuous mode: switching to it, or its layout changed – keep the reading position
    effect(() => {
      const mode = this.store.mode();
      const l = this.layout();
      if (mode !== 'continuous' || l.boxes.length === 0) return;
      untracked(() => requestAnimationFrame(() => this.placeContinuous()));
    });
    // a new view element (mode switch): the focus goes into it
    effect(() => {
      this.store.mode();
      untracked(() => setTimeout(() => this.focusView()));
    });
    effect(() => {
      // leaving continuous: the next switch jumps to the page shown
      if (this.store.mode() === 'single') {
        untracked(() => {
          this.anchor = null;
          this.pendingJump = this.store.page();
        });
      }
    });
    // load ahead
    effect(() => {
      const page = this.store.page();
      const n = this.store.pageCount();
      const w = this.width();
      this.store.token();
      untracked(() => this.prefetch(page, n, w));
    });
    // notes disappear by themselves
    effect(() => {
      if (this.store.notice() === null) return;
      untracked(() => {
        clearTimeout(this.noticeTimer);
        this.noticeTimer = setTimeout(() => this.store.notice.set(null), 2500);
      });
    });
    this.wake();
  }

  protected src(index: number): string | null {
    if (this.failed()[index]) return null;
    return this.store.pageUrl(index, this.width(), this.retries()[index] ?? 0);
  }

  private prefetch(page: number, n: number, width: number): void {
    this.prefetched = prefetchPages(page, n).flatMap((i) => {
      const url = this.store.pageUrl(i, width);
      if (!url || typeof Image === 'undefined') return [];
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      return [img];
    });
  }

  /** Focus into the page – unless the user works in the bar. */
  private focusView(): void {
    const root = this.root()?.nativeElement;
    const active = root?.ownerDocument.activeElement;
    if (root?.querySelector('.bar')?.contains(active ?? null)) return;
    this.view()?.nativeElement.focus({ preventScroll: true });
  }

  // ---- position ---------------------------------------------------------------------------

  private placeSingle(): void {
    const v = this.view()?.nativeElement;
    if (!v) return;
    v.scrollLeft = this.store.rtl() ? v.scrollWidth : 0;
    v.scrollTop = this.enterAtEnd ? v.scrollHeight : 0;
  }

  private placeContinuous(): void {
    const v = this.view()?.nativeElement;
    if (!v) return;
    const boxes = this.layout().boxes;
    let top: number;
    if (this.pendingJump !== null) {
      top = boxes[Math.min(this.pendingJump, boxes.length - 1)]?.top ?? 0;
      this.pendingJump = null;
    } else if (this.anchor) {
      top = scrollTopOf(boxes, this.anchor);
    } else {
      return;
    }
    v.scrollTop = top;
    this.scrollTop.set(top);
    this.anchor = anchorOf(boxes, top);
  }

  protected onScroll(): void {
    const v = this.view()?.nativeElement;
    if (!v || this.store.mode() !== 'continuous') return;
    const top = v.scrollTop;
    this.scrollTop.set(top);
    const boxes = this.layout().boxes;
    this.anchor = anchorOf(boxes, top);
    this.store.goTo(currentPage(boxes, top, this.viewHeight()));
  }

  /** Jump to a page (slider, first, last). */
  private jump(index: number): void {
    if (this.store.mode() === 'continuous') {
      this.pendingJump = Math.max(0, Math.min(index, this.store.pageCount() - 1));
      this.placeContinuous();
    }
    this.enterAtEnd = false;
    this.store.goTo(index);
  }

  /** One step: scroll inside a high page (or the continuous strip), else turn. */
  private turn(dir: 1 | -1): void {
    const v = this.view()?.nativeElement;
    if (this.store.mode() === 'continuous') {
      if (!v) return;
      const s = step(dir, v.scrollTop, v.clientHeight, v.scrollHeight);
      if (s.kind === 'scroll') v.scrollTo({ top: s.top });
      return;
    }
    if (v) {
      const s = step(dir, v.scrollTop, v.clientHeight, v.scrollHeight);
      if (s.kind === 'scroll') {
        v.scrollTo({ top: s.top });
        return;
      }
    }
    this.enterAtEnd = dir < 0;
    if (dir > 0) this.store.next();
    else this.store.prev();
  }

  // ---- input ------------------------------------------------------------------------------

  private run(cmd: ReaderCommand): void {
    switch (cmd) {
      case 'next':
        return this.turn(1);
      case 'prev':
        return this.turn(-1);
      case 'first':
        return this.jump(0);
      case 'last':
        return this.jump(this.store.pageCount() - 1);
      case 'toggleMode':
        return this.store.toggleMode();
      case 'toggleFit':
        return this.store.toggleFit();
      case 'toggleRtl':
        return this.store.toggleRtl();
      case 'nextBook':
        return this.store.nextBook();
      case 'prevBook':
        return this.store.prevBook();
      case 'fullscreen':
        void this.store.toggleFullscreen();
        return;
      case 'close':
        void this.store.escape();
        return;
    }
  }

  protected onKeydown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (e.key === 'Tab') {
      this.trapFocus(e);
      return;
    }
    // the slider and the buttons keep their own keys
    if (
      target instanceof HTMLInputElement &&
      [
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Home',
        'End',
        'PageUp',
        'PageDown',
      ].includes(e.key)
    ) {
      return;
    }
    if (target instanceof HTMLButtonElement && (e.key === ' ' || e.key === 'Enter')) return;
    const cmd = keyCommand(e, this.store.rtl());
    if (cmd === null) return;
    e.preventDefault();
    e.stopPropagation();
    const once = cmd !== 'next' && cmd !== 'prev';
    if (once && e.repeat) return;
    if (
      this.store.phase() !== 'ready' &&
      !['close', 'fullscreen', 'nextBook', 'prevBook'].includes(cmd)
    ) {
      return;
    }
    this.run(cmd);
  }

  private trapFocus(e: KeyboardEvent): void {
    const root = this.root()?.nativeElement;
    if (!root) return;
    const items = [
      ...root.querySelectorAll<HTMLElement>('button:not([disabled]), input, [tabindex="0"]'),
    ];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = root.ownerDocument.activeElement;
    if (e.shiftKey && (active === first || active === root)) {
      last.focus();
      e.preventDefault();
    } else if (!e.shiftKey && active === last) {
      first.focus();
      e.preventDefault();
    }
  }

  protected onViewClick(e: MouseEvent): void {
    if (this.swiped) {
      this.swiped = false;
      return;
    }
    const v = this.view()?.nativeElement;
    if (!v) return;
    const rect = v.getBoundingClientRect();
    const zone = clickZone(e.clientX - rect.left, rect.width, this.store.rtl());
    if (zone === null) {
      this.wake();
      return;
    }
    this.turn(zone === 'next' ? 1 : -1);
  }

  protected onPointerDown(e: PointerEvent): void {
    this.pointer = { x: e.clientX, y: e.clientY };
  }

  protected onPointerUp(e: PointerEvent): void {
    const p = this.pointer;
    this.pointer = null;
    if (!p || this.store.mode() !== 'single') return;
    const dir = swipe(e.clientX - p.x, e.clientY - p.y, this.store.rtl());
    if (dir === null) return;
    this.swiped = true;
    this.turn(dir === 'next' ? 1 : -1);
  }

  protected onSlider(e: Event): void {
    this.jump(Number((e.target as HTMLInputElement).value) - 1);
  }

  protected onLoad(e: Event, index: number): void {
    const img = e.target as HTMLImageElement;
    this.store.setSize(index, img.naturalWidth, img.naturalHeight);
    if (this.store.mode() === 'single' && index === this.store.page() && this.enterAtEnd) {
      this.placeSingle();
    }
  }

  protected onError(index: number): void {
    const n = this.retries()[index] ?? 0;
    if (n >= MAX_RETRIES) {
      this.failed.update((f) => ({ ...f, [index]: true }));
      return;
    }
    const timer = setTimeout(
      () => {
        this.retryTimers.delete(timer);
        this.retries.update((r) => ({ ...r, [index]: n + 1 }));
      },
      this.retryMs * (n + 1),
    );
    this.retryTimers.add(timer);
  }

  protected retry(index: number): void {
    this.failed.update((f) => {
      const next = { ...f };
      delete next[index];
      return next;
    });
    this.retries.update((r) => ({ ...r, [index]: (r[index] ?? 0) + 1 }));
  }

  protected openExternal(): void {
    const s = this.session.session();
    const book = this.store.book();
    if (s && book) void this.books.openExternal(s.categoryId, book.id).catch(() => undefined);
  }

  // ---- bar --------------------------------------------------------------------------------

  protected wake(): void {
    this.idle.set(false);
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      const root = this.root()?.nativeElement;
      const focusInBar = !!root?.querySelector('.bar')?.contains(root.ownerDocument.activeElement);
      if (!this.overBar() && !focusInBar) this.idle.set(true);
    }, this.idleMs);
  }

  protected setOverBar(over: boolean): void {
    this.overBar.set(over);
    if (over) this.wake();
  }
}
