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
import { isEmptyFilter, matchesFilter, parseFilter } from './filter-logic';
import { CursorMove, moveCursor } from './grid-math';
import { GRID_TEXTS } from './grid-texts';
import { extractSeriesFilter } from './series-filter';
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
  readonly filtered = computed(() => {
    const f = parseFilter(this.appliedFilter());
    const all = this.sorted();
    return isEmptyFilter(f) ? all : all.filter((b) => matchesFilter(keyOf(b), f));
  });
  readonly total = computed(() => this.scan.books().length);
  readonly filtering = computed(() => this.filterText().trim() !== '');
  private readonly indexById = computed(
    () => new Map(this.filtered().map((b, i) => [b.id, i] as const)),
  );
  /** Index of the cursor in `filtered()`, -1 = none. */
  readonly cursor = computed(() => {
    const id = this.focusId();
    return id === null ? -1 : (this.indexById().get(id) ?? -1);
  });
  readonly focused = computed(() => this.filtered()[this.cursor()] ?? null);

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

  move(move: CursorMove, cols: number, pageRows: number): void {
    const list = this.filtered();
    const i = moveCursor(this.cursor(), move, cols, list.length, pageRows);
    this.focusId.set(list[i]?.id ?? null);
    this.revealTick.update((n) => n + 1);
  }

  focusIndex(index: number): void {
    const b = this.filtered()[index];
    if (b) {
      this.focusId.set(b.id);
      this.revealTick.update((n) => n + 1);
    }
  }

  filterSeries(book: BookEntry): void {
    this.applyFilterNow(extractSeriesFilter(book.name));
    this.focusId.set(book.id);
  }

  /** Opens the reader on `book` within the filtered list (`]` / `[` follow this order). */
  read(book: BookEntry): void {
    const list = this.filtered();
    this.reader.open(this.categoryId(), list, list.indexOf(book));
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
