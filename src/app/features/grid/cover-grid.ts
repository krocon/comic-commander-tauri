import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  InjectionToken,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TableSignalComponent } from '@guiexpert/angular-table';
import {
  CoverGridFactory,
  CoverGridTableModel,
  GeMouseEvent,
  GeScrollEvent,
  TableApi,
  TableOptions,
  TableOptionsIf,
} from '@guiexpert/table';
import { CoversApi } from '../../core/covers/covers-api';
import { BookEntry } from '../../core/scan/scan.models';
import { CategoryStore } from '../category/category.store';
import { BookAction, BookMenu } from './book-menu';
import { bookInfo } from './book-info';
import { GridItem } from './grouping';
import { CoverRenderer } from './cover-renderer';
import { CoverRetries } from './cover-retries';
import {
  CursorMove,
  loadDimIndex,
  pageRows,
  scrollForTop,
  scrollToShow,
  topIndex,
} from './grid-math';
import { GRID_TEXTS } from './grid-texts';
import { Geometry, geometry, shelfHeight } from './shelf-math';
import { ShelfBackdrop } from './shelf-backdrop';
import { GridStore } from './grid.store';
import { ReaderService } from '../reader/reader.service';
import { ThumbsJobStore } from '../jobs/thumbs-job.store';
import { ActionService } from '../../core/actions/action.service';
import { KeyboardDispatcher } from '../../core/actions/keyboard-dispatcher';

/** Height of the floating toolbar = padding above the first row (design 004 „Zielbild“). */
export const GRID_TOP = 56;
/** Height of the breadcrumb below the toolbar in a level (design 011) – `.crumbs` in the view. */
export const CRUMBS_HEIGHT = 28;

/** Pause before a failed cover is asked for again: n × this (tests set it small). */
export const COVER_RETRY_MS = new InjectionToken<number>('COVER_RETRY_MS', {
  factory: () => 2000,
});

/** Width of a vertical scroll bar (0 with overlay scroll bars, e.g. macOS). */
function scrollbarWidth(doc: Document): number {
  const probe = doc.createElement('div');
  probe.style.cssText = 'position:absolute;top:-999px;width:100px;height:100px;overflow:scroll';
  doc.body.appendChild(probe);
  const w = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return Number.isFinite(w) ? w : 0;
}

/**
 * The cover grid (design 004): GuiExpert `CoverGridTableModel` with a plain DOM renderer,
 * randlos stretched to the width (E6), the first row below the floating toolbar. The grid
 * gets its books from the `GridStore` (sorted, filtered) – the table only shows them; the model
 * is built once, new books (background scan, filter) go into it without a new table.
 *
 * Keyboard (E7): arrows, Home/End, PgUp/PgDn move the cursor, Enter reads, Space/Shift+F10/context key open the actions, typing goes to the filter
 * (`typed`), Esc clears the filter. The table's own shortcuts are off. Screen readers hear the
 * focused book through a live region (the table resets `aria-activedescendant` in every pass –
 * the cover grid has no focus model, see design 004 E8).
 */
@Component({
  selector: 'app-cover-grid',
  imports: [TableSignalComponent, BookMenu],
  templateUrl: './cover-grid.html',
  styleUrl: './cover-grid.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoverGrid {
  protected readonly store = inject(GridStore);
  private readonly scan = inject(CategoryStore);
  private readonly covers = inject(CoversApi);
  private readonly reader = inject(ReaderService);
  private readonly job = inject(ThumbsJobStore);
  private readonly actions = inject(ActionService);
  private readonly dispatcher = inject(KeyboardDispatcher);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly t = GRID_TEXTS;

  /** A printable key in the grid – the view puts it into the filter (E3). */
  readonly typed = output<string>();
  /** Esc in the grid. */
  readonly escape = output<void>();

  protected readonly api = signal<TableApi | undefined>(undefined);
  private readonly hostWidth = signal(0);
  private readonly viewHeight = signal(0);
  private scrollTop = 0;
  private readonly scrollbar = scrollbarWidth(inject(ElementRef).nativeElement.ownerDocument);
  private readonly dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;

  /** Padding above the first row: the toolbar, in a level also the breadcrumb (design 011). */
  readonly top = computed(() => GRID_TOP + (this.store.crumbs().length ? CRUMBS_HEIGHT : 0));
  /** Columns, cells and covers for the look (design 015: grid or shelf). */
  readonly layout = computed<Geometry>(() =>
    geometry(this.store.look(), Math.max(0, this.hostWidth() - this.scrollbar), this.store.dim()),
  );
  /** The wood behind the table in the shelf look (design 015 E2). */
  private backdrop: ShelfBackdrop | null = null;
  /** The thumbnail size loaded for the shown cover size (E2). */
  private readonly loadDim = computed(() =>
    loadDimIndex(this.store.dims(), this.layout().coverWidth, this.dpr),
  );
  private readonly retries = new CoverRetries(inject(COVER_RETRY_MS), () => this.repaintSoon());

  private readonly renderer = new CoverRenderer({
    src: (b) => {
      const url = this.coverUrl(b);
      return url === null ? null : this.retries.src(url);
    },
    failed: (b) => {
      const url = this.coverUrl(b);
      if (url !== null) this.retries.failed(url);
    },
    isFocused: (i) => i.id === untracked(this.store.focusId),
    progress: (i) => {
      if (i.kind === 'group') return i.progress;
      const p = untracked(this.reader.positions)[i.book.id];
      return p && p.pages > 0 ? (p.page + 1) / p.pages : null;
    },
    coverHeight: () => untracked(this.layout).coverHeight,
    title: (i) => this.tileTitle(i),
    shelf: () => untracked(this.layout).shelf,
  });

  protected readonly model: CoverGridTableModel<GridItem> = CoverGridFactory.createCoverGridModel(
    [],
    this.renderer,
    200,
    300,
    0,
    GRID_TOP,
  );
  protected readonly options: TableOptionsIf = {
    ...new TableOptions(),
    horizontalBorderVisible: false,
    verticalBorderVisible: false,
    footerSeparatorBorderVisible: false,
    headerSeparatorBorderVisible: false,
    fixedEastSeparatorBorderVisible: false,
    fixedWestSeparatorBorderVisible: false,
    tableTopBorderVisible: false,
    tableBottomBorderVisible: false,
    hoverColumnVisible: false,
    hoverRowVisible: false,
    overflowY: 'scroll', // the width is computed without the scroll bar
    overflowX: 'auto',
    defaultRowHeights: { header: 0, body: 300, footer: 0 },
    shortcutActionsDisabled: true,
    // the view shows its own notes (no books, nothing matches)
    overlayOptions: { autoNoRows: false },
    ariaLabel: GRID_TEXTS.gridLabel,
  };

  /** The actions menu: tile and position in the grid. */
  protected readonly menu = signal<{ item: GridItem; x: number; y: number } | null>(null);

  protected readonly announcement = computed(() => {
    const i = this.store.focusedItem();
    if (!i) return '';
    const name =
      i.kind === 'book'
        ? i.book.name
        : this.t.groupLabel(i.group, i.label, i.count, i.total, i.read);
    return this.t.focused(name, this.store.cursor() + 1, this.store.items().length);
  });

  /** Spoken once when the look changes (grid / shelf). */
  protected readonly lookNote = signal('');

  private repaintPending = false;
  private lastLayoutKey = '';

  constructor() {
    const el = this.host.nativeElement;
    this.registerActions();

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => {
        const r = entries[0]?.contentRect;
        if (r) {
          this.hostWidth.set(Math.floor(r.width));
          this.viewHeight.set(Math.floor(r.height));
        }
      });
      ro.observe(el);
      inject(DestroyRef).onDestroy(() => ro.disconnect());
    }
    inject(DestroyRef).onDestroy(() => this.retries.dispose());

    // books, size, width → the model (no new table); the phase ends a pending restore
    effect(() => {
      const list = this.store.items();
      const layout = this.layout();
      const api = this.api();
      const top = this.top();
      this.scan.phase();
      untracked(() => this.applyModel(list, layout, api, top));
    });
    // the cursor: repaint (frame)
    effect(() => {
      this.store.focusId();
      untracked(() => this.repaintSoon());
    });
    // a move of the user keeps the cursor visible – new books never pull the view back (review 004 #3)
    effect(() => {
      this.store.revealTick();
      untracked(() => this.reveal(this.store.cursor()));
    });
    // covers made by the batch job (design 007 E6): failed ones get a fresh chance
    effect(() => {
      const ready = this.job.ready();
      untracked(() => this.onCoversReady(ready));
    });
    // reading positions (design 005 E5): the bars
    effect(() => {
      this.reader.positions();
      untracked(() => this.repaintSoon());
    });
    // back from the reader: the grid gets the focus again (the cursor is set by the store)
    effect(() => {
      if (!this.reader.closedOn()) return;
      untracked(() => setTimeout(() => this.focus()));
    });
    // the window's height: more or fewer boards (design 015)
    effect(() => {
      this.viewHeight();
      untracked(() => this.syncBackdrop());
    });
    // the look changed: say so (live region, design 015 requirement 12)
    let firstLook = true;
    effect(() => {
      const look = this.store.look();
      if (firstLook) {
        firstLook = false;
        return;
      }
      untracked(() => this.lookNote.set(this.t.looks[look]));
    });
    inject(DestroyRef).onDestroy(() => this.backdrop?.remove());
    // a new loaded size: other URLs
    effect(() => {
      this.loadDim();
      untracked(() => this.repaintSoon());
    });
  }

  /** Tooltip: the path, and what is known about series and number (design 011). */
  private tileTitle(item: GridItem): string {
    if (item.kind === 'group') {
      return this.t.groupLabel(item.group, item.label, item.count, item.total, item.read);
    }
    const info = bookInfo(item.book);
    const parts: string[] = [];
    if (info.series) {
      const n = info.number ? ` #${info.number}` : '';
      parts.push(`${info.series}${n} (${this.t.sourceOf[info.seriesSource ?? 'name']})`);
    }
    if (info.title) parts.push(info.title);
    if (info.year) parts.push(String(info.year));
    if (info.writer) parts.push(info.writer);
    return this.t.bookTitle(item.book.relPath, parts.length ? parts.join(' · ') : null);
  }

  private coverUrl(book: BookEntry): string | null {
    const c = untracked(this.store.category);
    return c ? this.covers.coverUrl(c.id, book, untracked(this.loadDim)) : null;
  }

  private onCoversReady(ready: readonly { categoryId: string; bookId: string }[]): void {
    const c = this.store.category();
    if (!c || ready.length === 0) return;
    const ids = new Set(ready.filter((r) => r.categoryId === c.id).map((r) => r.bookId));
    if (ids.size === 0) return;
    let changed = false;
    for (const item of this.store.items()) {
      const b = item.kind === 'book' ? item.book : item.cover;
      if (!ids.has(b.id)) continue;
      const url = this.coverUrl(b);
      if (url !== null && this.retries.forget(url)) changed = true;
    }
    if (changed) this.repaintSoon();
  }

  private applyModel(
    list: GridItem[],
    layout: Geometry,
    api: TableApi | undefined,
    top = GRID_TOP,
  ): void {
    const body = this.model.bodyModel;
    body.firstRowPaddingTop = top;
    this.model.paddingTop = top;
    body.items = list;
    body.filteredItems = list;
    // the model's „cover“ is the cell: the cover itself (grid) or a slot on a board (shelf)
    body.coverWidth = layout.cellWidth;
    body.coverHeight = layout.rowHeight;
    // exactly `cols` columns (the model computes floor(width / coverWidth))
    this.model.setParentWidth(layout.cols * layout.cellWidth);
    this.model.recalcHeightAndPadding();
    this.syncBackdrop();
    if (!api || this.hostWidth() === 0) return;
    // TODO(guiexpert): CoverGridBodyModel.getRowCount() adds an empty row when the last row is full
    api.repaintHard();

    // position: a pending restore (E10), else keep the top book when the layout changed
    const key = `${layout.cols}x${layout.rowHeight}x${layout.shelf ? 's' : 'g'}`;
    const pending = this.store.restoreTopId();
    if (pending !== null && list.length) {
      const i = list.findIndex((b) => b.id === pending);
      // found, or the scan is over and the book gone (review 004 #6)
      if (i >= 0 || this.scan.phase() !== 'scanning') {
        this.store.restoreTopId.set(null);
        if (i >= 0) this.scrollTo(scrollForTop(i, layout.cols, layout.rowHeight));
      }
    } else if (key !== this.lastLayoutKey && this.lastLayoutKey !== '') {
      // other size or width: the book with the cursor (else the top one) stays in view
      const anchor = this.store.focusId() ?? this.store.topId();
      const i = anchor === null ? -1 : list.findIndex((b) => b.id === anchor);
      if (i >= 0) this.scrollTo(scrollForTop(i, layout.cols, layout.rowHeight));
    }
    this.lastLayoutKey = key;
  }

  /**
   * The wood of the shelf look under the table (design 015 E2): created on the switch, laid out
   * for the scroll position – called from the table's scroll event, so it moves with the books.
   */
  private syncBackdrop(): void {
    const shelf = untracked(this.layout).shelf;
    if (!shelf) {
      this.backdrop?.remove();
      this.backdrop = null;
      return;
    }
    // in the table's scroll viewport, under the content (E2); before the table exists: the host
    const viewport = untracked(this.api)?.getTableScope().scrollViewport;
    const parent = viewport ?? this.host.nativeElement;
    this.backdrop ??= new ShelfBackdrop(this.host.nativeElement.ownerDocument);
    if (this.backdrop.element.parentElement !== parent) parent.prepend(this.backdrop.element);
    const view = viewport?.clientHeight || untracked(this.viewHeight);
    const width = viewport?.clientWidth || this.host.nativeElement.clientWidth - this.scrollbar;
    const scrollTop = viewport ? viewport.scrollTop : 0;
    // as tall as the rows, at least the window – never from `scrollHeight`: that includes the
    // wood itself, it would never shrink again (a filter left the view scrolled into nothing)
    const height = shelfHeight(
      untracked(this.top),
      this.model.bodyModel.getRowCount(),
      shelf.rowHeight,
      view,
    );
    this.backdrop.update(shelf, untracked(this.top), scrollTop, view, width, height);
  }

  /** Repaints once per frame (cursor, retries) – not per event. */
  private repaintSoon(): void {
    if (this.repaintPending) return;
    this.repaintPending = true;
    requestAnimationFrame(() => {
      this.repaintPending = false;
      this.api()?.repaint();
    });
  }

  private reveal(index: number): void {
    // not laid out yet: nothing to compute against (review 004 #7)
    if (!this.api() || this.viewHeight() === 0) return;
    const l = this.layout();
    const top = scrollToShow(
      index,
      l.cols,
      l.rowHeight,
      this.top(),
      this.viewHeight(),
      this.scrollTop,
    );
    if (top !== null) this.scrollTo(top);
  }

  private scrollTo(top: number): void {
    const api = this.api();
    if (!api) return;
    this.scrollTop = top;
    api.scrollToPixel(0, top);
  }

  protected onScroll(e: GeScrollEvent): void {
    this.scrollTop = e.scrollTop;
    if (e.clientHeight) this.viewHeight.set(e.clientHeight);
    const l = this.layout();
    const list = this.store.items();
    this.syncBackdrop();
    const id = list[Math.min(list.length - 1, topIndex(e.scrollTop, l.cols, l.rowHeight))]?.id;
    if (id && id !== this.store.topId()) this.store.topId.set(id);
  }

  scrollToStart(): void {
    this.scrollTo(0);
  }

  scrollToEnd(): void {
    this.scrollTo(this.model.getContentHeightInPixel());
  }

  /** Focus into the grid (the table's host is the tab stop). */
  focus(): void {
    const target = this.api()?.getTableScope().hostElement ?? this.host.nativeElement;
    target.focus({ preventScroll: true });
    if (this.store.cursor() < 0) this.store.focusIndex(0);
  }

  private bookAt(e: GeMouseEvent): number {
    if (e.areaIdent !== 'body' || e.rowIndex < 0 || e.columnIndex < 0) return -1;
    const i = e.rowIndex * this.layout().cols + e.columnIndex;
    return i < this.store.items().length ? i : -1;
  }

  protected onClick(e: GeMouseEvent): void {
    const i = this.bookAt(e);
    if (i < 0) return;
    this.store.focusIndex(i);
    const item = this.store.items()[i];
    if (item.kind === 'group') {
      // a click opens a group (design 011 E2)
      this.menu.set(null);
      this.store.open(item);
    } else if (e.clickCount >= 2) {
      this.menu.set(null);
      void this.act('read', item);
    } else {
      this.openMenu(item, e.originalEvent);
    }
  }

  protected onContextMenu(e: GeMouseEvent): void {
    e.originalEvent?.preventDefault();
    const i = this.bookAt(e);
    if (i < 0) return;
    this.store.focusIndex(i);
    this.openMenu(this.store.items()[i], e.originalEvent);
  }

  private openMenu(item: GridItem, at?: MouseEvent): void {
    const rect = this.host.nativeElement.getBoundingClientRect();
    let x: number;
    let y: number;
    if (at) {
      // beside the pointer: the second click of a double click must reach the cover (review 004 #1)
      x = at.clientX - rect.left + 12;
      y = at.clientY - rect.top + 12;
    } else {
      // at the focused cover
      const l = this.layout();
      const i = this.store.cursor();
      x = (i % l.cols) * l.cellWidth + l.cellWidth / 3;
      y = this.top() + Math.floor(i / l.cols) * l.rowHeight - this.scrollTop + l.rowHeight / 3;
    }
    // inside the grid (menu ≈ 16 × 12 rem)
    x = Math.max(4, Math.min(x, rect.width - 260));
    y = Math.max(this.top(), Math.min(y, rect.height - 200));
    this.menu.set({ item, x, y });
  }

  protected closeMenu(): void {
    this.menu.set(null);
    this.focus();
  }

  protected async onAction(action: BookAction): Promise<void> {
    const m = this.menu();
    if (!m) return;
    this.closeMenu();
    await this.act(action, m.item);
  }

  private async act(action: BookAction, item: GridItem): Promise<void> {
    if (item.kind === 'group') {
      switch (action) {
        case 'read':
          this.store.open(item);
          return;
        case 'readGroup':
          this.store.readGroup(item);
          return;
        case 'series':
          this.store.filterSeries(item.cover);
          return;
        default:
          return; // no file actions on a group
      }
    }
    const book = item.book;
    switch (action) {
      case 'read':
        this.store.read(book);
        return;
      case 'readGroup':
        return;
      case 'open':
        return this.store.openExternal(book);
      case 'reveal':
        return this.store.reveal(book);
      case 'series':
        this.store.filterSeries(book);
        return;
      case 'copy':
        return this.store.copyPath(book);
    }
  }

  /** The grid's actions (design 008): cursor, read, menu, book actions; typing → filter. */
  private registerActions(): void {
    const destroyRef = inject(DestroyRef);
    const move = (m: CursorMove) => ({
      run: () => {
        const l = this.layout();
        this.store.move(m, l.cols, pageRows(this.viewHeight(), l.rowHeight, this.top()));
      },
    });
    const onBook = (action: BookAction) => ({
      run: () => {
        const b = this.store.focused();
        if (b) void this.act(action, { kind: 'book', id: b.id, book: b });
      },
      enabled: () => this.store.focused() !== null,
    });
    this.actions.registerAll(
      {
        'grid.left': move('left'),
        'grid.right': move('right'),
        'grid.up': move('up'),
        'grid.down': move('down'),
        'grid.pageUp': move('pageUp'),
        'grid.pageDown': move('pageDown'),
        'grid.home': move('home'),
        'grid.end': move('end'),
        // Enter: a book is read, a group opens (design 011)
        'grid.read': {
          run: () => {
            const i = this.store.focusedItem();
            if (i) void this.act('read', i);
          },
          enabled: () => this.store.focusedItem() !== null,
        },
        'grid.levelUp': {
          run: () => this.store.up(),
          enabled: () => this.store.level() !== null,
        },
        'grid.menu': {
          run: () => {
            const i = this.store.focusedItem();
            if (i) this.openMenu(i);
          },
          enabled: () => this.store.focusedItem() !== null,
        },
        'grid.escape': { run: () => this.escape.emit() },
        'book.openExternal': onBook('open'),
        'book.reveal': onBook('reveal'),
        'book.filterSeries': {
          run: () => {
            const i = this.store.focusedItem();
            if (i) void this.act('series', i);
          },
          enabled: () => {
            const i = this.store.focusedItem();
            if (!i) return false;
            if (i.kind === 'group') return i.group === 'series';
            return bookInfo(i.book).series !== null;
          },
        },
        'book.copyPath': onBook('copy'),
      },
      destroyRef,
    );
    // a printable key in the grid goes to the filter (004 E3) – no action
    const typing = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1 || e.key === ' ') return false;
      this.typed.emit(e.key);
      return true;
    };
    this.dispatcher.setFallback('grid', typing);
    destroyRef.onDestroy(() => this.dispatcher.clearFallback('grid', typing));
  }
}
