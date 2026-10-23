import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { bookInfo } from './book-info';
import { GridItem } from './grouping';
import { GRID_TEXTS } from './grid-texts';
import { ActionService } from '../../core/actions/action.service';

export type BookAction = 'read' | 'open' | 'reveal' | 'series' | 'copy' | 'readGroup';

interface Item {
  action: BookAction;
  label: string;
  icon: string;
  disabled: boolean;
  /** Shortcut of the same action in the grid (design 008 E9). */
  shortcut: string;
}

const ACTION_OF: Record<BookAction, string> = {
  read: 'grid.read',
  open: 'book.openExternal',
  reveal: 'book.reveal',
  series: 'book.filterSeries',
  copy: 'book.copyPath',
  readGroup: '',
};

/**
 * Actions on one book (design 004): a menu (WAI-ARIA APG) at the cover. ↑/↓/Home/End move,
 * Enter/Space choose, Esc or a click outside closes – the grid gets the focus back. „Read“ can be
 * disabled (`canRead`); since prompt 006 every book can be read.
 *
 * A group (design 011): open, read the first unread book, filter the series – no file actions.
 */
@Component({
  selector: 'app-book-menu',
  template: `
    <ul
      class="menu"
      role="menu"
      tabindex="-1"
      [attr.aria-label]="label()"
      [style.left.px]="x()"
      [style.top.px]="y()"
      (keydown)="onKey($event)"
    >
      @for (item of items(); track item.action; let i = $index) {
        <li
          role="menuitem"
          tabindex="-1"
          [attr.aria-disabled]="item.disabled || null"
          [class.disabled]="item.disabled"
          (click)="choose(i)"
          (keydown.enter)="onItemEnter($event, i)"
        >
          <i [class]="'fa fa-fw fa-' + item.icon" aria-hidden="true"></i>
          <span>{{ item.label }}</span>
          @if (item.shortcut) {
            <kbd aria-hidden="true">{{ item.shortcut }}</kbd>
          }
        </li>
      }
    </ul>
  `,
  styleUrl: './book-menu.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:pointerdown)': 'onDocumentPointer($event)' },
})
export class BookMenu {
  readonly item = input.required<GridItem>();
  readonly x = input(0);
  readonly y = input(0);
  readonly canRead = input(true);
  readonly chosen = output<BookAction>();
  readonly closed = output<void>();

  protected readonly t = GRID_TEXTS;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly focused = signal(0);

  private readonly actions = inject(ActionService);
  protected readonly label = computed(() => {
    const i = this.item();
    return i.kind === 'book' ? this.t.bookMenu(i.book.name) : this.t.groupMenu(i.label);
  });
  protected readonly items = computed<Item[]>(() =>
    this.baseItems().map((i) => ({
      ...i,
      shortcut: ACTION_OF[i.action] ? this.actions.shortcut(ACTION_OF[i.action]) : '',
    })),
  );
  private readonly baseItems = computed<Omit<Item, 'shortcut'>[]>(() => {
    const it = this.item();
    if (it.kind === 'group') {
      return [
        { action: 'read', label: this.t.openGroup, icon: 'folder-open-o', disabled: false },
        { action: 'readGroup', label: this.t.readGroup, icon: 'book', disabled: false },
        ...(it.group === 'series'
          ? [
              {
                action: 'series' as const,
                label: this.t.filterSeries,
                icon: 'filter',
                disabled: false,
              },
            ]
          : []),
      ];
    }
    return [
      {
        action: 'read',
        label: this.t.read,
        icon: 'book',
        disabled: !this.canRead(),
      },
      { action: 'open', label: this.t.openExternal, icon: 'external-link', disabled: false },
      { action: 'reveal', label: this.t.reveal, icon: 'folder-open-o', disabled: false },
      {
        action: 'series',
        label: this.t.filterSeries,
        icon: 'filter',
        disabled: bookInfo(it.book).series === null,
      },
      { action: 'copy', label: this.t.copyPath, icon: 'clipboard', disabled: false },
    ];
  });

  constructor() {
    afterNextRender(() => this.focus(this.items().findIndex((i) => !i.disabled)));
  }

  protected onKey(event: KeyboardEvent): void {
    const n = this.items().length;
    const i = this.focused();
    switch (event.key) {
      case 'ArrowDown':
        this.focus((i + 1) % n);
        break;
      case 'ArrowUp':
        this.focus((i - 1 + n) % n);
        break;
      case 'Home':
        this.focus(0);
        break;
      case 'End':
        this.focus(n - 1);
        break;
      case ' ':
        // Enter is handled by the item (keydown.enter)
        this.choose(i);
        break;
      case 'Escape':
      case 'Tab':
        this.closed.emit();
        break;
      default:
        return;
    }
    // never to the grid behind the menu
    event.preventDefault();
    event.stopPropagation();
  }

  protected onItemEnter(event: Event, i: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.choose(i);
  }

  protected choose(i: number): void {
    const item = this.items()[i];
    if (!item || item.disabled) return;
    this.chosen.emit(item.action);
  }

  protected onDocumentPointer(event: PointerEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.closed.emit();
  }

  private focus(i: number): void {
    this.focused.set(i);
    this.host.nativeElement.querySelectorAll<HTMLElement>('[role="menuitem"]')[i]?.focus();
  }
}
