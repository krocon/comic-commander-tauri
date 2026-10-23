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
  clickZone,
  currentPage,
  FitMode,
  guessSizes,
  layoutPages,
  pageWidth,
  prefetchPages,
  ReaderCommand,
  scrollTopOf,
  sliderToFactor,
  factorToSlider,
  snapFactor,
  step2d,
  swipe,
  visibleRange,
  ZOOM_CYCLE,
} from './reader-logic';
import { ZOOM_ICONS, ZoomChoice, ZoomMenu } from './zoom-menu';
import { READER_TEXTS } from './reader-texts';
import { ReaderStore } from './reader.store';
import { ReaderService } from './reader.service';
import { ActionHandler, ActionService } from '../../core/actions/action.service';

/** Pause before a failed page is asked for again: n × this (tests set it small). */
export const PAGE_RETRY_MS = new InjectionToken<number>('PAGE_RETRY_MS', { factory: () => 1000 });
/** The toolbar (and the pointer over the page) hides after this long without movement. */
export const BAR_IDLE_MS = new InjectionToken<number>('BAR_IDLE_MS', { factory: () => 2500 });
/** A free zoom asks for sharper pages this long after the last change (014: not per pixel). */
export const ZOOM_SETTLE_MS = new InjectionToken<number>('ZOOM_SETTLE_MS', {
  factory: () => 250,
});
/** Travel (px) after which pressing on a large page drags it instead of clicking (014 E4). */
const PAN_MIN = 4;
/** Automatic retries of a page (503 when busy, a book still unpacking). */
const MAX_RETRIES = 2;

/**
 * The reader (design 005, 014): a layer over the category view (E6) – single page or continuous
 * (virtualised), four fits + free zoom, rotation per book, first scroll then turn; keys, clicks
 * into the outer thirds, swipes, dragging large pages; slider and „12 / 48“; next / previous
 * book; full screen; a quiet toolbar that fades out while reading. A dialog for
 * assistive technology (`role="dialog"`, focus stays inside, page changes announced).
 * Keys in one handler on the layer (CLAUDE.md §4: no scattered handlers).
 */
@Component({
  selector: 'app-reader',
  imports: [ZoomMenu],
  templateUrl: './reader.html',
  styleUrl: './reader.css',
  providers: [ReaderStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Reader {
  protected readonly store = inject(ReaderStore);
  private readonly books = inject(BooksApi);
  private readonly session = inject(ReaderService);
  private readonly actions = inject(ActionService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly retryMs = inject(PAGE_RETRY_MS);
  private readonly idleMs = inject(BAR_IDLE_MS);
  private readonly settleMs = inject(ZOOM_SETTLE_MS);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly t = READER_TEXTS;

  private readonly root = viewChild<ElementRef<HTMLElement>>('root');
  private readonly view = viewChild<ElementRef<HTMLElement>>('view');

  private readonly viewWidth = signal(0);
  private readonly viewHeight = signal(0);
  private readonly scrollTop = signal(0);
  private readonly dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;

  /** Bar hidden (014 E11: no pointer in its zone for a while, no focus inside, not pinned). */
  protected readonly idle = signal(false);
  /** Pointer over the page hidden (it rests). */
  protected readonly cursorIdle = signal(false);
  private readonly overBar = signal(false);
  /** Something in the bar is in use (zoom menu open, slider dragged): it stays. */
  private readonly barBusy = signal(false);
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private cursorTimer: ReturnType<typeof setTimeout> | undefined;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
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
  /** Continuous mode: the anchor is this many px below the top of the view (zoom at a point). */
  private anchorOffset = 0;
  /** Where the view looks (fractions of the content) and at which view point (014: kept when
   *  the zoom, the rotation or the window changes). */
  private focusPoint = { fx: 0, fy: 0, px: 0, py: 0 };
  private pointer: { x: number; y: number; left: number; top: number; id: number } | null = null;
  private panned = false;
  protected readonly panning = signal(false);
  private swiped = false;

  /** Sizes of all pages (unknown ones guessed). */
  private readonly sizes = computed(() =>
    guessSizes(
      Array.from({ length: this.store.pageCount() }, (_, i) => this.store.sizes()[i] ?? null),
    ),
  );
  /** The zoom the page URLs follow: a free zoom only after it settled (014 Anforderung 13). */
  private readonly settledZoom = signal(this.store.zoom());
  /** Target width per page (014: from the box, replaces 005's one width). */
  private readonly widths = computed(() => {
    const z = this.settledZoom();
    return layoutPages(
      this.sizes(),
      this.viewWidth(),
      this.viewHeight(),
      z,
      this.store.rotation(),
    ).boxes.map((b) => pageWidth(b, this.dpr, z));
  });
  protected readonly bookName = computed(() => this.store.book()?.name ?? '');
  protected readonly errorText = computed(() => {
    const e = this.store.error();
    return e ? describeFsError(e) : '';
  });
  protected readonly pageLabel = computed(() =>
    this.t.page(this.store.page() + 1, this.store.pageCount()),
  );
  protected readonly layout = computed(() =>
    layoutPages(
      this.sizes(),
      this.viewWidth(),
      this.viewHeight(),
      this.store.zoom(),
      this.store.rotation(),
    ),
  );
  /** The box of the page shown (single mode, effective zoom). */
  protected readonly fit = computed(() => this.layout().boxes[this.store.page()] ?? null);
  /** Width of the continuous strip: pages wider than the view scroll sideways. */
  protected readonly trackWidth = computed(() =>
    Math.max(this.viewWidth(), this.layout().maxWidth),
  );
  /** Larger than the view: the mouse can drag it (014 E4; continuous: only sideways). */
  protected readonly pannable = computed(() => {
    if (this.store.mode() === 'continuous') return this.trackWidth() > this.viewWidth() + 1;
    const f = this.fit();
    return !!f && (f.width > this.viewWidth() + 1 || f.height > this.viewHeight() + 1);
  });
  /** Effective factor of the page shown, in % (the zoom slider, 014 E7). */
  protected readonly percent = computed(() => Math.round((this.fit()?.scale ?? 1) * 100));
  protected readonly sliderValue = computed(() => factorToSlider(this.fit()?.scale ?? 1));
  /** The effective factor of the last fit mode: the slider snaps to it (E7). */
  private lastFitFactor = 1;

  /** The four fits of the toolbar with their shortcuts from the keymap. */
  protected readonly zoomChoices = computed<ZoomChoice[]>(() => {
    this.actions.keymap();
    const label = {
      width: this.t.fitWidth,
      height: this.t.fitHeight,
      page: this.t.fitPage,
      full: this.t.fullSize,
    };
    return ZOOM_CYCLE.map((mode) => ({
      mode,
      label: label[mode],
      key: this.actions.shortcut(`reader.zoom.${mode}`),
      icon: ZOOM_ICONS[mode],
    }));
  });
  /** Tooltip text with the shortcut of an action. */
  protected tip(label: string, actionId: string): string {
    this.actions.keymap();
    return this.t.withKey(label, this.actions.shortcut(actionId));
  }
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
      // the view without its scroll bars (014: else fit width makes a horizontal bar on
      // Linux/Windows); the host until the view exists
      const ro = new ResizeObserver((entries) => {
        const r = entries[0]?.contentRect;
        if (r) {
          this.viewWidth.set(Math.floor(r.width));
          this.viewHeight.set(Math.floor(r.height));
        }
      });
      effect(() => {
        const v = this.view()?.nativeElement;
        ro.disconnect();
        ro.observe(v ?? el);
      });
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
      clearTimeout(this.cursorTimer);
      clearTimeout(this.settleTimer);
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
        this.wake();
        if (this.store.phase() === 'ready') setTimeout(() => this.focusView());
      });
    });
    // the page URLs follow a free zoom only after it settled; fits at once
    effect(() => {
      const z = this.store.zoom();
      untracked(() => {
        clearTimeout(this.settleTimer);
        if (z.mode !== 'custom') {
          this.settledZoom.set(z);
          return;
        }
        this.settleTimer = setTimeout(() => this.settledZoom.set(z), this.settleMs);
      });
    });
    // the factor of a fit, for the slider's snap (E7)
    effect(() => {
      const f = this.fit();
      if (f && this.store.zoom().mode !== 'custom') this.lastFitFactor = f.scale;
    });
    // single mode: zoom, rotation or window changed on the same page – keep where the view looks
    let shown = '';
    effect(() => {
      const f = this.fit();
      if (this.store.mode() !== 'single' || !f) return;
      const page = this.store.page();
      const key = `${page}:${f.width}x${f.height}`;
      untracked(() => {
        const samePage = shown.startsWith(`${page}:`);
        if (key === shown) return;
        shown = key;
        if (samePage) requestAnimationFrame(() => this.keepFocus());
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
      const w = this.widths();
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
    this.registerActions();
    this.wake();
  }

  protected src(index: number): string | null {
    if (this.failed()[index]) return null;
    return this.store.pageUrl(index, this.widths()[index] ?? 0, this.retries()[index] ?? 0);
  }

  private prefetch(page: number, n: number, widths: readonly number[]): void {
    this.prefetched = prefetchPages(page, n).flatMap((i) => {
      const url = this.store.pageUrl(i, widths[i] ?? 0);
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
    // start of the first row (manga: right); after turning back the end of the last row
    const right = this.store.rtl() !== this.enterAtEnd;
    v.scrollLeft = right ? v.scrollWidth : 0;
    v.scrollTop = this.enterAtEnd ? v.scrollHeight : 0;
    this.noteFocus();
  }

  /** Remembers where the view looks: its centre (or `point`, zoom at the pointer). */
  private noteFocus(point?: { x: number; y: number }): void {
    const v = this.view()?.nativeElement;
    if (!v) return;
    const px = point?.x ?? v.clientWidth / 2;
    const py = point?.y ?? v.clientHeight / 2;
    this.focusPoint = {
      fx: v.scrollWidth > 0 ? (v.scrollLeft + px) / v.scrollWidth : 0,
      fy: v.scrollHeight > 0 ? (v.scrollTop + py) / v.scrollHeight : 0,
      px,
      py,
    };
  }

  /** Scrolls so that the remembered place is at the remembered view point again. */
  private keepFocus(): void {
    const v = this.view()?.nativeElement;
    if (!v) return;
    const f = this.focusPoint;
    v.scrollLeft = Math.max(0, f.fx * v.scrollWidth - f.px);
    if (this.store.mode() === 'single') v.scrollTop = Math.max(0, f.fy * v.scrollHeight - f.py);
    this.noteFocus();
  }

  private placeContinuous(): void {
    const v = this.view()?.nativeElement;
    if (!v) return;
    const boxes = this.layout().boxes;
    let top: number;
    let jumped = false;
    if (this.pendingJump !== null) {
      top = boxes[Math.min(this.pendingJump, boxes.length - 1)]?.top ?? 0;
      this.pendingJump = null;
      jumped = true;
    } else if (this.anchor) {
      top = Math.max(0, scrollTopOf(boxes, this.anchor) - this.anchorOffset);
    } else {
      return;
    }
    v.scrollTop = top;
    this.scrollTop.set(top);
    this.anchor = anchorOf(boxes, top);
    this.anchorOffset = 0;
    // sideways: a jump starts at the reading side, else the same place of the strip (014)
    if (jumped) v.scrollLeft = this.store.rtl() ? v.scrollWidth : 0;
    else requestAnimationFrame(() => this.keepFocus());
  }

  protected onScroll(): void {
    const v = this.view()?.nativeElement;
    if (!v) return;
    this.noteFocus();
    if (this.store.mode() !== 'continuous') return;
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

  /** One step: scroll through a large page (rows, 014 Anforderung 4) or the strip, else turn. */
  private turn(dir: 1 | -1): void {
    const v = this.view()?.nativeElement;
    const s = v
      ? step2d(
          dir,
          { left: v.scrollLeft, top: v.scrollTop },
          { width: v.clientWidth, height: v.clientHeight },
          { width: v.scrollWidth, height: v.scrollHeight },
          this.store.rtl(),
        )
      : null;
    if (s?.kind === 'scroll') {
      v!.scrollTo({ left: s.left, top: s.top });
      return;
    }
    if (this.store.mode() === 'continuous') return;
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

  /** Tab stays in the reader (focus trap of the dialog); every other key is an action. */
  protected onRootKey(e: KeyboardEvent): void {
    if (e.key === 'Tab') this.trapFocus(e);
  }

  /** The reader's actions (design 008): keys, menus and the palette run them. */
  private registerActions(): void {
    const ready = () => this.store.phase() === 'ready';
    const page = (cmd: ReaderCommand) => ({ run: () => this.run(cmd), enabled: ready });
    const any = (cmd: ReaderCommand) => ({ run: () => this.run(cmd) });
    this.actions.registerAll(
      {
        'reader.next': page('next'),
        'reader.prev': page('prev'),
        // manga mirrors only the horizontal keys (E4)
        'reader.right': {
          run: () => this.run(this.store.rtl() ? 'prev' : 'next'),
          enabled: ready,
        },
        'reader.left': {
          run: () => this.run(this.store.rtl() ? 'next' : 'prev'),
          enabled: ready,
        },
        // Mod+←/→: the end on that side (manga: left = last page)
        'reader.rightEnd': {
          run: () => this.run(this.store.rtl() ? 'first' : 'last'),
          enabled: ready,
        },
        'reader.leftEnd': {
          run: () => this.run(this.store.rtl() ? 'last' : 'first'),
          enabled: ready,
        },
        'reader.first': page('first'),
        'reader.last': page('last'),
        'reader.toggleMode': {
          ...page('toggleMode'),
          checked: () => this.store.mode() === 'continuous',
        },
        // zoom and rotation (design 014)
        ...this.zoomActions(ready),
        'reader.zoom.next': { run: () => this.store.cycleZoom(1), enabled: ready },
        'reader.zoom.prev': { run: () => this.store.cycleZoom(-1), enabled: ready },
        'reader.zoomIn': { run: () => this.zoomBy(1), enabled: ready },
        'reader.zoomOut': { run: () => this.zoomBy(-1), enabled: ready },
        'reader.toggleZoomSlider': {
          run: () => this.store.toggleZoomSlider(),
          checked: () => this.store.zoomSlider(),
        },
        'reader.rotateLeft': { run: () => this.store.rotate(-1), enabled: ready },
        'reader.rotateRight': { run: () => this.store.rotate(1), enabled: ready },
        'reader.toggleToolbar': {
          run: () => {
            this.store.toggleToolbar();
            this.wake();
          },
          checked: () => this.store.toolbarPinned(),
        },
        'reader.toggleRtl': { ...page('toggleRtl'), checked: () => this.store.rtl() },
        'reader.fullscreen': { ...any('fullscreen'), checked: () => this.store.fullscreen() },
        'reader.nextBook': any('nextBook'),
        'reader.prevBook': any('prevBook'),
        'reader.close': any('close'),
      },
      this.destroyRef,
    );
  }

  private zoomActions(ready: () => boolean): Record<string, ActionHandler> {
    const out: Record<string, ActionHandler> = {};
    for (const mode of ZOOM_CYCLE) {
      out[`reader.zoom.${mode}`] = {
        run: () => this.setZoomMode(mode),
        enabled: ready,
        checked: () => this.store.zoom().mode === mode,
      };
    }
    return out;
  }

  protected setZoomMode(mode: FitMode): void {
    this.store.setZoomMode(mode);
  }

  /** `+` / `-`: one step from the effective factor, around the middle of the view. */
  private zoomBy(dir: 1 | -1): void {
    this.noteFocus();
    this.store.zoomBy(dir, this.fit()?.scale ?? 1);
  }

  /** Mod+wheel / pinch (014 E1): zoom around the pointer. */
  protected onWheel(e: WheelEvent): void {
    if (!(e.ctrlKey || e.metaKey) || this.store.phase() !== 'ready') return;
    e.preventDefault();
    const v = this.view()?.nativeElement;
    if (!v) return;
    const rect = v.getBoundingClientRect();
    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    this.noteFocus(point);
    if (this.store.mode() === 'continuous') {
      const boxes = this.layout().boxes;
      this.anchor = anchorOf(boxes, v.scrollTop + point.y);
      this.anchorOffset = point.y;
    }
    const k = Math.exp(-Math.max(-50, Math.min(50, e.deltaY)) * 0.01);
    this.store.setFactor((this.fit()?.scale ?? 1) * k);
  }

  /** The zoom slider (014 E7): logarithmic, snaps to 100 % and the last fit. */
  protected onZoomSlider(e: Event): void {
    // whole percents: the slider's log scale gives 2.003 for „200 %“
    const raw =
      Math.round(sliderToFactor(Number((e.target as HTMLInputElement).value)) * 100) / 100;
    const f = snapFactor(raw, [1, this.lastFitFactor]);
    this.noteFocus();
    this.store.setFactor(f);
  }

  /** End of dragging the zoom slider: say the factor once. */
  protected onZoomSliderDone(): void {
    this.barBusy.set(false);
    this.store.say(this.t.zoomIs(this.t.percent(this.percent())));
    this.wake();
  }

  protected onZoomSliderStart(): void {
    this.barBusy.set(true);
  }

  protected onZoomMenuOpen(open: boolean): void {
    this.barBusy.set(open);
    if (!open) this.wake();
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
      // the middle shows or hides the bar (touch has no hover, 014 Anforderung 20)
      if (this.idle()) this.wake();
      else this.hideBar();
      return;
    }
    this.turn(zone === 'next' ? 1 : -1);
  }

  /** Content wider than the view: dragging moves it, swiping does not turn (014 E4). */
  private overflowsSideways(): boolean {
    const v = this.view()?.nativeElement;
    return !!v && v.scrollWidth > v.clientWidth + 1;
  }

  protected onPointerDown(e: PointerEvent): void {
    const v = this.view()?.nativeElement;
    this.panned = false;
    this.pointer = {
      x: e.clientX,
      y: e.clientY,
      left: v?.scrollLeft ?? 0,
      top: v?.scrollTop ?? 0,
      id: e.pointerId,
    };
  }

  protected onPointerMove(e: PointerEvent): void {
    this.wakeCursor();
    const p = this.pointer;
    const v = this.view()?.nativeElement;
    // touch scrolls by itself; the mouse drags a page larger than the view
    if (!p || !v || e.pointerType !== 'mouse' || p.id !== e.pointerId) return;
    if (!this.pannable()) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!this.panned && Math.hypot(dx, dy) < PAN_MIN) return;
    if (!this.panned) {
      this.panned = true;
      this.panning.set(true);
      v.setPointerCapture?.(e.pointerId);
    }
    v.scrollLeft = p.left - dx;
    v.scrollTop = p.top - dy;
  }

  protected onPointerUp(e: PointerEvent): void {
    const p = this.pointer;
    this.pointer = null;
    if (this.panned) {
      this.panned = false;
      this.panning.set(false);
      this.swiped = true; // no click after dragging
      return;
    }
    if (!p || this.store.mode() !== 'single' || this.overflowsSideways()) return;
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

  // ---- bar (014 E11) -----------------------------------------------------------------------

  /** Shows the bar; it hides again after a rest – unless it is pointed at, focused, in use or
   *  pinned (then the next `wake` tries again). */
  protected wake(): void {
    this.idle.set(false);
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (!this.barNeeded()) this.idle.set(true);
    }, this.idleMs);
  }

  private barNeeded(): boolean {
    const root = this.root()?.nativeElement;
    const focusInBar = !!root?.querySelector('.bar')?.contains(root.ownerDocument.activeElement);
    return this.overBar() || focusInBar || this.barBusy() || this.store.toolbarPinned();
  }

  private hideBar(): void {
    clearTimeout(this.idleTimer);
    if (!this.barNeeded()) this.idle.set(true);
  }

  /** The pointer moves over the page: show it (not the bar), hide it again after a rest. */
  protected wakeCursor(): void {
    this.cursorIdle.set(false);
    clearTimeout(this.cursorTimer);
    this.cursorTimer = setTimeout(() => this.cursorIdle.set(true), this.idleMs);
  }

  protected setOverBar(over: boolean): void {
    this.overBar.set(over);
    this.wake();
  }

  /** Focus left the bar: it may hide after the rest. */
  protected onBarFocusOut(): void {
    this.wake();
  }
}
