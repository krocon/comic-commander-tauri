import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CategoriesStore } from '../categories/categories.store';
import { CATEGORY_TEXTS } from './category-texts';
import { JOBS_TEXTS } from '../jobs/jobs-texts';
import { DialogService } from '../../shared/dialog/dialog.service';

type Item =
  { kind: 'category'; id: string } | { kind: 'manage' } | { kind: 'import' } | { kind: 'thumbs' };

/**
 * Menu button of the toolbar (WAI-ARIA APG „menu button“): the categories as
 * `menuitemradio`, then „Manage categories…“ and „Import old config…“.
 * ↓/Enter/Space open, ↑/↓/Home/End move, Enter/Space choose, Esc closes (focus back to the
 * button), Tab or a click outside closes.
 */
@Component({
  selector: 'app-category-menu',
  templateUrl: './category-menu.html',
  styleUrl: './category-menu.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:pointerdown)': 'onDocumentPointer($event)' },
})
export class CategoryMenu {
  protected readonly store = inject(CategoriesStore);
  protected readonly t = CATEGORY_TEXTS;
  protected readonly jt = JOBS_TEXTS;
  private readonly dialogs = inject(DialogService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly open = signal(false);
  protected readonly focused = signal(0);
  protected readonly items = computed<Item[]>(() => [
    ...this.store.categories().map((c) => ({ kind: 'category' as const, id: c.id })),
    { kind: 'manage' },
    { kind: 'import' },
    { kind: 'thumbs' },
  ]);

  protected toggle(): void {
    if (this.open()) this.close(true);
    else this.show('checked');
  }

  protected onButtonKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.show('checked');
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.show('last');
    }
  }

  protected onMenuKey(event: KeyboardEvent): void {
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
        // Enter is handled by the item itself (keydown.enter)
        this.choose(i);
        break;
      case 'Escape':
        this.close(true);
        break;
      case 'Tab':
        this.close(false);
        return; // let the focus move on
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  /**
   * Enter on an item: consumed here – otherwise WebKit activates the menu button, which has the
   * focus again by then, and the menu opens a second time (found in the E2E test, design 002).
   */
  protected onItemEnter(event: Event, i: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.choose(i);
  }

  protected itemId(i: number): string {
    return `category-menu-item-${i}`;
  }

  protected choose(i: number): void {
    const item = this.items()[i];
    this.close(item?.kind === 'category');
    if (!item) return;
    if (item.kind === 'category') void this.store.select(item.id);
    else if (item.kind === 'manage') this.store.openManage();
    else if (item.kind === 'thumbs') this.dialogs.show('thumbs');
    else void this.store.startImport();
  }

  protected onDocumentPointer(event: PointerEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.close(false);
    }
  }

  private show(where: 'checked' | 'last'): void {
    const active = this.store.config().activeId;
    const checked = this.items().findIndex((x) => x.kind === 'category' && x.id === active);
    this.open.set(true);
    this.focus(where === 'last' ? this.items().length - 1 : Math.max(0, checked));
  }

  private focus(i: number): void {
    this.focused.set(i);
    // the menu is rendered after this change detection
    setTimeout(() =>
      this.host.nativeElement.querySelector<HTMLElement>(`#${this.itemId(i)}`)?.focus(),
    );
  }

  private close(focusButton: boolean): void {
    this.open.set(false);
    if (focusButton) {
      // after the current key event – it must not reach the button
      setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('.menu-button')?.focus());
    }
  }
}
