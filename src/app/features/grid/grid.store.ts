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
import { BooksApi } from '../../core/books/books-api';
import { ThumbsDim } from '../../core/categories/categories.models';
import { describeFsError, toFsError } from '../../core/errors/fs-error';
import { BookEntry } from '../../core/scan/scan.models';
import { CategoriesStore } from '../categories/categories.store';
import { filterKey, SortMode, sortBooksBy } from '../category/book-order';
import { CategoryStore } from '../category/category.store';
import { ReaderService } from '../reader/reader.service';
import { bookInfo } from './book-info';
import { hasFieldTerms, isEmptyFilter, matchesFilter, parseFilter } from './filter-logic';
import { CursorMove, moveCursor } from './grid-math';
import { GRID_TEXTS } from './grid-texts';
import {
  bookItems,
  breadcrumb,
  folderLevel,
  GridItem,
  GroupItem,
  groupBySeries,
  levelExists,
  levelTileId,
  parentLevel,
  seriesBooks,
  ViewMode,
} from './grouping';
import { KeyValueStore, loadViewState, saveViewState } from './view-state';

/** Pause between typing and filtering (the template: 333 ms; local data is fast). */
export const FILTER_DEBOUNCE_MS = new InjectionToken<number>('FILTER_DEBOUNCE_MS', {
  factory: () => 150,
});
/** Where view states live (tests pass a map). */
export const VIEW_STATE_STORE = new InjectionToken<KeyValueStore | null>('VIEW_STATE_STORE', {
  factory: () => {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  },
});

const FALLBACK_DIMS: readonly ThumbsDim[] = [{ width: 200, height: 300, nameExtension: '' }];

/** `filterKey()` once per book object (50 000 books: the filter must stay < 50 ms). */
const keys = new WeakMap<BookEntry, string>();
function keyOf(b: BookEntry): string {
  let k = keys.get(b);
  if (k === undefined) {
    k = filterKey(b);
    keys.set(b, k);
  }
  return k;
}

/**
 * State of the cover grid (design 004): order, filter, size, cursor and the actions on a book.
 * Next to the `CategoryStore` of the view (not `providedIn: 'root'`). Remembers its state per
 * category (E9) and restores it when the category is opened again.
 *
 * Design 011: a view (flat, series, folders) and a level in it; the grid shows `items()` –
 * books and groups. The cursor and the top position are tile ids.
 */
@Injectable()
export class GridStore {
  private readonly categories = inject(CategoriesStore);
  private readonly scan = inject(CategoryStore);
  private readonly books = inject(BooksApi);
  private readonly reader = inject(ReaderService);
  private readonly debounceMs = inject(FILTER_DEBOUNCE_MS);
  private readonly stateStore = inject(VIEW_STATE_STORE);
  private filterTimer: ReturnType<typeof setTimeout> | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private loadedFor: string | null = null;

  readonly category = computed(() => this.categories.active());
  /** The text in the filter field. */
  readonly filterText = signal('');
  /** The filter in force (debounced). */
  readonly appliedFilter = signal('');
  readonly sort = signal<SortMode>('path');
  readonly view = signal<ViewMode>('flat');
  /** Opened series (key) or folder (NFC, `/`); `null` = the top of the view. */
  readonly level = signal<string | null>(null);
  /**
   * The filter of the series overview while a series is open: opening a series clears the
   * filter (all its volumes), back on the overview it is in force again.
   */
  readonly outerFilter = signal<string | null>(null);
  /** Chosen size step (index into `dims()`). */
  readonly dimIndex = signal(0);
  /** Book with the keyboard cursor. */
  readonly focusId = signal<string | null>(null);
  /** First book of the top row – kept for the next visit (E10). */
  readonly topId = signal<string | null>(null);
  /** Position to restore once the grid is laid out (consumed by the grid). */
  readonly restoreTopId = signal<string | null>(null);
  /** Counts the cursor moves of the user – only they scroll the grid (review 004 #3). */
  readonly revealTick = signal(0);
  /** Message of the last action (error or „copied“), for the status line. */
  readonly message = signal<{ text: string; error: boolean } | null>(null);

  readonly dims = computed<readonly ThumbsDim[]>(() => {
    const d = this.category()?.thumbsDims;
    return d?.length ? d : FALLBACK_DIMS;
  });
  readonly dim = computed(() => {
    const d = this.dims();
    return d[Math.min(Math.max(0, this.dimIndex()), d.length - 1)];
  });

  readonly sorted = computed(() => {
    const all = this.scan.books();
    // the scan delivers path order already
    return this.sort() === 'path' ? all : sortBooksBy(all, this.sort());
  });
  /** The books that pass the filter, in the chosen order (all levels). */
  readonly filtered = computed(() => {
    const f = parseFilter(this.appliedFilter());
    const all = this.sorted();
    if (isEmptyFilter(f)) return all;
    const fields = hasFieldTerms(f);
    return all.filter((b) => matchesFilter(keyOf(b), f, fields ? () => bookInfo(b) : undefined));
  });
  private readonly progressOf = (b: BookEntry): number | null => {
    const p = this.reader.positions()[b.id];
    return p && p.pages > 0 ? (p.page + 1) / p.pages : null;
  };
  /** The tiles of the shown level (design 011). */
  readonly items = computed<GridItem[]>(() => {
    const shown = this.filtered();
    const level = this.level();
    switch (this.view()) {
      case 'flat':
        return bookItems(shown);
      case 'series':
        return level === null
          ? groupBySeries(this.scan.books(), shown, this.sort(), this.progressOf)
          : bookItems(seriesBooks(shown, level));
      case 'folders':
        return folderLevel(this.scan.books(), shown, level ?? '', this.progressOf);
    }
  });
  /** The books of the level in display order – what the reader goes through. */
  readonly levelBooks = computed(() =>
    this.items()
      .filter((i) => i.kind === 'book')
      .map((i) => i.book),
  );
  readonly crumbs = computed(() =>
    breadcrumb(this.view(), this.level(), GRID_TEXTS.topOf[this.view()], (key) => {
      const b = this.scan.books().find((x) => bookInfo(x).seriesKey === key);
      return (b && bookInfo(b).series) ?? key;
    }),
  );
  readonly total = computed(() => this.scan.books().length);
  readonly filtering = computed(() => this.filterText().trim() !== '');
  private readonly indexById = computed(
    () => new Map(this.items().map((b, i) => [b.id, i] as const)),
  );
  /** Index of the cursor in `items()`, -1 = none. */
  readonly cursor = computed(() => {
    const id = this.focusId();
    return id === null ? -1 : (this.indexById().get(id) ?? -1);
  });
  readonly focusedItem = computed<GridItem | null>(() => this.items()[this.cursor()] ?? null);
  /** The book with the cursor (`null` on a group). */
  readonly focused = computed(() => {
    const i = this.focusedItem();
    return i?.kind === 'book' ? i.book : null;
  });

  constructor() {
    // a category opened: its remembered state (E9) or the defaults of the category
    effect(() => {
      const c = this.category();
      const id = c?.id ?? null;
      if (id === this.loadedFor) return;
      untracked(() => this.loadFor(id));
    });
    // every change is remembered (debounced)
    effect(() => {
      const state = this.snapshot();
      const id = this.loadedFor;
      if (!id) return;
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => saveViewState(id, state, this.stateStore), 300);
    });
    // a level whose books are all gone (scan, restored state): back to the top (design 011)
    effect(() => {
      const level = this.level();
      if (level === null || this.scan.phase() !== 'done') return;
      const all = this.scan.books();
      untracked(() => {
        if (!levelExists(all, this.view(), level)) this.setLevel(null);
      });
    });
    // back from the reader: the cursor on the book read last (design 005 E6)
    effect(() => {
      const closed = this.reader.closedOn();
      if (!closed) return;
      untracked(() => {
        if (this.indexById().has(closed.bookId)) {
          this.focusId.set(closed.bookId);
          this.revealTick.update((n) => n + 1);
        }
      });
    });
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.filterTimer);
      this.saveNow();
    });
  }

  /** The state of the open category, written now (switch, close – review 004 #5). */
  private saveNow(): void {
    clearTimeout(this.saveTimer);
    if (this.loadedFor) saveViewState(this.loadedFor, this.snapshot(), this.stateStore);
  }

  private snapshot() {
    return {
      filter: this.filterText(),
      dimIndex: this.dimIndex(),
      sort: this.sort(),
      focusId: this.focusId(),
      topId: this.topId(),
      view: this.view(),
      level: this.level(),
      outerFilter: this.outerFilter(),
    };
  }

  private loadFor(id: string | null): void {
    this.saveNow();
    this.loadedFor = id;
    clearTimeout(this.filterTimer);
    const c = this.category();
    const saved = id ? loadViewState(id, this.stateStore) : null;
    const filter = saved?.filter ?? c?.initialFilter ?? '';
    this.filterText.set(filter);
    this.appliedFilter.set(filter);
    this.sort.set(saved?.sort ?? 'path');
    this.view.set(saved?.view ?? 'flat');
    this.level.set(saved?.level ?? null);
    this.outerFilter.set(
      this.view() === 'series' && this.level() !== null ? (saved?.outerFilter ?? null) : null,
    );
    this.dimIndex.set(saved?.dimIndex ?? c?.dimIndex ?? 0);
    this.focusId.set(saved?.focusId ?? null);
    this.topId.set(saved?.topId ?? null);
    // no top book saved: the cursor book (review 004 #7)
    this.restoreTopId.set(saved?.topId ?? saved?.focusId ?? null);
    this.message.set(null);
  }

  setFilter(text: string): void {
    this.filterText.set(text);
    clearTimeout(this.filterTimer);
    this.filterTimer = setTimeout(() => this.appliedFilter.set(text), this.debounceMs);
  }

  /** Without waiting (clear, series, Enter). */
  applyFilterNow(text = this.filterText()): void {
    clearTimeout(this.filterTimer);
    this.filterText.set(text);
    this.appliedFilter.set(text);
  }

  setSort(mode: SortMode): void {
    this.sort.set(mode);
  }

  setDim(index: number): void {
    const n = this.dims().length;
    this.dimIndex.set(Math.min(Math.max(0, index), n - 1));
  }

  /** `Mod +/−`: the next larger / smaller size. */
  stepDim(delta: 1 | -1): void {
    const d = this.dims();
    const current = this.dim();
    const bySize = d.map((x, i) => ({ w: x.width, i })).sort((a, b) => a.w - b.w);
    const pos = bySize.findIndex((x) => x.i === d.indexOf(current));
    const next = bySize[Math.min(bySize.length - 1, Math.max(0, pos + delta))];
    this.dimIndex.set(next.i);
  }

  /** Another view: its top level, the cursor on the tile of the book that had it (a group: its first book). */
  setView(view: ViewMode): void {
    if (view === this.view()) return;
    const item = this.focusedItem();
    const book = item?.kind === 'group' ? item.cover : (item?.book ?? null);
    this.setLevel(null);
    this.view.set(view);
    this.focusOn(book ? this.tileOf(book) : null);
  }

  /** The tile that holds `book` at the shown level (a group or the book itself). */
  private tileOf(book: BookEntry): string | null {
    const items = this.items();
    if (items.some((i) => i.id === book.id)) return book.id;
    const group = items.find(
      (i): i is GroupItem =>
        i.kind === 'group' &&
        (i.group === 'series'
          ? bookInfo(book).seriesKey === i.key
          : book.relPath.normalize('NFC').startsWith(i.key + '/')),
    );
    return group?.id ?? null;
  }

  /**
   * Changes the level. Series view: opening a series keeps the filter of the overview aside and
   * shows all volumes; back on the overview that filter is in force again.
   */
  private setLevel(level: string | null): void {
    const from = this.level();
    if (this.view() === 'series') {
      if (from === null && level !== null) {
        this.outerFilter.set(this.filterText());
        this.applyFilterNow('');
      } else if (level === null) {
        const outer = this.outerFilter();
        this.outerFilter.set(null);
        if (outer !== null) this.applyFilterNow(outer);
      }
    }
    this.level.set(level);
  }

  private focusOn(id: string | null): void {
    this.focusId.set(id ?? this.items()[0]?.id ?? null);
    this.restoreTopId.set(this.focusId());
    this.revealTick.update((n) => n + 1);
  }

  /** A group opens its level; a book is read. */
  open(item: GridItem): void {
    if (item.kind === 'book') {
      this.read(item.book);
      return;
    }
    this.setLevel(item.key);
    this.focusOn(null);
  }

  /** One level up (the cursor on the tile of the level left); `false` at the top. */
  up(): boolean {
    const level = this.level();
    if (level === null || this.view() === 'flat') return false;
    this.goTo(parentLevel(this.view(), level));
    return true;
  }

  /** A level of the breadcrumb (`null` = the top); the cursor on the way back. */
  goTo(level: string | null): void {
    const from = this.level();
    if (level === from) return;
    this.setLevel(level);
    let tile: string | null = null;
    if (from !== null && (level === null || from.startsWith(level + '/'))) {
      // the tile on the way down from `level` to where we came from
      const view = this.view();
      let next = from;
      if (view === 'folders') {
        const start = level === null ? 0 : level.length + 1;
        const slash = from.indexOf('/', start);
        next = slash < 0 ? from : from.substring(0, slash);
      }
      tile = levelTileId(view, next);
    }
    this.focusOn(tile);
  }

  move(move: CursorMove, cols: number, pageRows: number): void {
    const list = this.items();
    const i = moveCursor(this.cursor(), move, cols, list.length, pageRows);
    this.focusId.set(list[i]?.id ?? null);
    this.revealTick.update((n) => n + 1);
  }

  focusIndex(index: number): void {
    const b = this.items()[index];
    if (b) {
      this.focusId.set(b.id);
      this.revealTick.update((n) => n + 1);
    }
  }

  /** `series:"…"` (design 011 E8); the cursor stays on the book (or its group). */
  filterSeries(book: BookEntry): void {
    const series = bookInfo(book).series;
    if (!series) return;
    this.applyFilterNow(`series:"${series.replace(/"/gu, ' ').replace(/\s+/gu, ' ').trim()}"`);
    this.focusOn(this.tileOf(book));
  }

  /** Opens the reader on `book` within the books of the level (`]` / `[` follow this order). */
  read(book: BookEntry): void {
    const list = this.levelBooks();
    const i = list.indexOf(book);
    if (i >= 0) this.reader.open(this.categoryId(), list, i);
  }

  /** The books of a group in reading order (series: by number; folder: by path, the subtree). */
  groupBooks(group: GroupItem): BookEntry[] {
    const shown = this.filtered();
    if (group.group === 'series') return seriesBooks(shown, group.key);
    const prefix = group.key + '/';
    const visible = new Set(shown);
    return this.scan
      .books()
      .filter((b) => visible.has(b) && b.relPath.normalize('NFC').startsWith(prefix));
  }

  /** The first book of a group that is not read to the end (else the first). */
  readGroup(group: GroupItem): void {
    const list = this.groupBooks(group);
    if (!list.length) return;
    const i = list.findIndex((b) => (this.progressOf(b) ?? 0) < 1);
    this.reader.open(this.categoryId(), list, Math.max(0, i));
  }

  async openExternal(book: BookEntry): Promise<void> {
    await this.run(() => this.books.openExternal(this.categoryId(), book.id));
  }

  async reveal(book: BookEntry): Promise<void> {
    await this.run(() => this.books.reveal(this.categoryId(), book.id));
  }

  async copyPath(book: BookEntry): Promise<void> {
    try {
      await navigator.clipboard.writeText(book.path);
      this.message.set({ text: GRID_TEXTS.copied, error: false });
    } catch (e) {
      this.message.set({ text: describeFsError(toFsError(e)), error: true });
    }
  }

  private categoryId(): string {
    return this.category()?.id ?? '';
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.message.set(null);
    try {
      await action();
    } catch (e) {
      this.message.set({ text: describeFsError(toFsError(e)), error: true });
    }
  }
}
