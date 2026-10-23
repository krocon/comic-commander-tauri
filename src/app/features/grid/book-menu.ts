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
import { BookEntry } from '../../core/scan/scan.models';
import { GRID_TEXTS } from './grid-texts';

export type BookAction = 'read' | 'open' | 'reveal' | 'series' | 'copy';

interface Item {
  action: BookAction;
  label: string;
  icon: string;
  disabled: boolean;
}

/**
 * Actions on one book (design 004): a menu (WAI-ARIA APG) at the cover. ↑/↓/Home/End move,
 * Enter/Space choose, Esc or a click outside closes – the grid gets the focus back. „Read“ can be
 * disabled (`canRead`); since prompt 006 every book can be read.
 */
@Component({
  selector: 'app-book-menu',
  template: `
    <ul
      class="menu"
      role="menu"
      tabindex="-1"
      [attr.aria-label]="t.bookMenu(book().name)"
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
        </li>
      }
    </ul>
  `,
  styleUrl: './book-menu.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:pointerdown)': 'onDocumentPointer($event)' },
})
export class BookMenu {
  readonly book = input.required<BookEntry>();
  readonly x = input(0);
  readonly y = input(0);
  readonly canRead = input(true);
  readonly chosen = output<BookAction>();
  readonly closed = output<void>();

  protected readonly t = GRID_TEXTS;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly focused = signal(0);

  protected readonly items = computed<Item[]>(() => [
    {
      action: 'read',
      label: this.t.read,
      icon: 'book',
      disabled: !this.canRead(),
    },
    { action: 'open', label: this.t.openExternal, icon: 'external-link', disabled: false },
    { action: 'reveal', label: this.t.reveal, icon: 'folder-open-o', disabled: false },
    { action: 'series', label: this.t.filterSeries, icon: 'filter', disabled: false },
    { action: 'copy', label: this.t.copyPath, icon: 'clipboard', disabled: false },
  ]);

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
