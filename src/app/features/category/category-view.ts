import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { describeFsError } from '../../core/errors/fs-error';
import { DialogService } from '../../shared/dialog/dialog.service';
import { CategoriesStore } from '../categories/categories.store';
import { CoverGrid, GRID_TOP } from '../grid/cover-grid';
import { GRID_TEXTS } from '../grid/grid-texts';
import { GridStore } from '../grid/grid.store';
import { SORT_MODES, SortMode } from './book-order';
import { CategoryMenu } from './category-menu';
import { CategoryStore } from './category.store';
import { CATEGORY_TEXTS } from './category-texts';

/**
 * The active category (design 002, 004): the cover grid with a floating toolbar (category
 * menu, filter, thumb size, order, scan again, to the top / bottom), status and notes; the
 * first-start screen. Scans again whenever the active category, its folder or its file types
 * change. Keys: `Mod+R` scan again, `Mod+1…9` choose a category, `Mod+F` filter,
 * `Mod +/−` cover size; the grid keys are in `CoverGrid`.
 */
@Component({
  selector: 'app-category-view',
  imports: [CategoryMenu, CoverGrid],
  templateUrl: './category-view.html',
  styleUrl: './category-view.css',
  providers: [CategoryStore, GridStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKeydown($event)', '[style.--grid-top.px]': 'gridTop' },
})
export class CategoryView {
  protected readonly categories = inject(CategoriesStore);
  protected readonly store = inject(CategoryStore);
  protected readonly grid = inject(GridStore);
  private readonly dialogs = inject(DialogService);
  protected readonly t = CATEGORY_TEXTS;
  protected readonly g = GRID_TEXTS;
  protected readonly gridTop = GRID_TOP;
  protected readonly sortModes = SORT_MODES;
  private readonly coverGrid = viewChild(CoverGrid);
  private readonly filterInput = viewChild<ElementRef<HTMLInputElement>>('filterInput');

  /** Ticks every 30 s for „updated 3 min ago“. */
  private readonly now = signal(Date.now());

  /** What is scanned: a change starts a new scan (design 002). */
  private readonly scanKey = computed(() => {
    if (!this.categories.loaded()) return null;
    const c = this.categories.active();
    return c ? [c.id, c.baseDir, ...c.bookExtensions].join('\u0000') : '';
  });

  /** The grid is there as soon as there are books. */
  protected readonly showGrid = computed(() => this.store.books().length > 0);

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
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected onFilterInput(event: Event): void {
    this.grid.setFilter((event.target as HTMLInputElement).value);
  }

  protected onFilterKey(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault();
      this.grid.applyFilterNow();
      this.coverGrid()?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (this.grid.filterText()) this.grid.applyFilterNow('');
      else this.coverGrid()?.focus();
    }
  }

  protected clearFilter(): void {
    this.grid.applyFilterNow('');
    this.filterInput()?.nativeElement.focus();
  }

  /** A key typed in the grid goes to the end of the filter (design 004 E3). */
  protected onTyped(char: string): void {
    const input = this.filterInput()?.nativeElement;
    this.grid.setFilter(this.grid.filterText() + char);
    if (input) {
      input.focus();
      // after Angular wrote the value
      setTimeout(() => input.setSelectionRange(input.value.length, input.value.length));
    }
  }

  protected onGridEscape(): void {
    if (this.grid.filterText()) this.grid.applyFilterNow('');
  }

  protected onSizeChange(event: Event): void {
    this.grid.setDim(Number((event.target as HTMLSelectElement).value));
  }

  protected onSortChange(event: Event): void {
    this.grid.setSort((event.target as HTMLSelectElement).value as SortMode);
  }

  protected toTop(): void {
    this.coverGrid()?.scrollToStart();
  }

  protected toBottom(): void {
    this.coverGrid()?.scrollToEnd();
  }

  protected rescan(): void {
    if (this.categories.active() && !this.store.scanning()) void this.store.rescan();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (this.dialogs.open() !== null || event.altKey) return;
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.key === '+' || event.key === '=' || event.key === '-') {
      event.preventDefault();
      this.grid.stepDim(event.key === '-' ? -1 : 1);
      return;
    }
    if (event.shiftKey) return;
    if (event.key === 'f' || event.key === 'F') {
      event.preventDefault();
      this.filterInput()?.nativeElement.focus();
      this.filterInput()?.nativeElement.select();
      return;
    }
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
