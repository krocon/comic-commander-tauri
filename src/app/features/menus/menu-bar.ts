import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { ActionService } from '../../core/actions/action.service';
import { MenuService } from './menu.service';
import { ResolvedItem } from './menu-model';
import { MENUS_TEXTS } from './menus-texts';

type Row =
  | { kind: 'item'; item: Extract<ResolvedItem, { kind: 'action' }> }
  | { kind: 'separator' }
  | { kind: 'group'; label: string };

/** Submenus become a labelled group of the open menu (one level is enough for the bar). */
function rows(items: ResolvedItem[]): Row[] {
  return items.flatMap((i): Row[] => {
    if (i.kind === 'separator') return [{ kind: 'separator' }];
    if (i.kind === 'submenu') {
      return [{ kind: 'separator' }, { kind: 'group', label: i.label }, ...rows(i.items)];
    }
    return [{ kind: 'item', item: i }];
  });
}

/**
 * The HTML menu bar of Windows and Linux (design 008 E8, WAI-ARIA APG „menubar“): ←/→ between
 * the menus, ↓/Enter/Space open, ↑/↓/Home/End in the menu, Enter/Space choose, Esc closes (the
 * focus goes back where it was), F10 (action `app.focusMenu`) enters the bar.
 */
@Component({
  selector: 'app-menu-bar',
  templateUrl: './menu-bar.html',
  styleUrl: './menu-bar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:pointerdown)': 'onDocumentPointer($event)' },
})
export class MenuBar {
  protected readonly menus = inject(MenuService).menus;
  private readonly actions = inject(ActionService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly t = MENUS_TEXTS;

  protected readonly open = signal<number | null>(null);
  protected readonly topFocus = signal(0);
  protected readonly rows = computed(() => {
    const i = this.open();
    return i === null ? [] : rows(this.menus()[i]?.items ?? []);
  });
  /** Where the focus was before the bar – it goes back there. */
  private before: HTMLElement | null = null;

  constructor() {
    this.actions.register('app.focusMenu', { run: () => this.enter() }, inject(DestroyRef));
  }

  enter(): void {
    this.remember();
    this.focusTop(0);
  }

  private remember(): void {
    const a = this.host.nativeElement.ownerDocument.activeElement;
    if (a instanceof HTMLElement && !this.host.nativeElement.contains(a)) this.before = a;
  }

  private tops(): HTMLElement[] {
    return [...this.host.nativeElement.querySelectorAll<HTMLElement>('.top > button')];
  }

  private items(): HTMLElement[] {
    return [...this.host.nativeElement.querySelectorAll<HTMLElement>('[role="menu"] li[tabindex]')];
  }

  private focusTop(i: number): void {
    const n = this.menus().length;
    const k = (i + n) % n;
    this.topFocus.set(k);
    setTimeout(() => this.tops()[k]?.focus());
  }

  private openMenu(i: number, item: 'first' | 'last' = 'first'): void {
    const n = this.menus().length;
    const k = (i + n) % n;
    this.open.set(k);
    this.topFocus.set(k);
    setTimeout(() => {
      const list = this.items();
      (item === 'first' ? list[0] : list[list.length - 1])?.focus();
    });
  }

  protected toggle(i: number): void {
    this.remember();
    if (this.open() === i) this.close(true);
    else this.openMenu(i);
  }

  protected hover(i: number): void {
    if (this.open() !== null && this.open() !== i) this.openMenu(i);
  }

  private close(toTop: boolean): void {
    const i = this.open();
    this.open.set(null);
    if (toTop && i !== null) this.focusTop(i);
  }

  private leave(): void {
    this.open.set(null);
    const b = this.before;
    this.before = null;
    if (b?.isConnected) setTimeout(() => b.focus());
    else (this.host.nativeElement.ownerDocument.activeElement as HTMLElement | null)?.blur();
  }

  protected onTopKey(e: KeyboardEvent, i: number): void {
    switch (e.key) {
      case 'ArrowRight':
        this.focusTop(i + 1);
        break;
      case 'ArrowLeft':
        this.focusTop(i - 1);
        break;
      case 'ArrowDown':
      case 'Enter':
      case ' ':
        this.openMenu(i);
        break;
      case 'ArrowUp':
        this.openMenu(i, 'last');
        break;
      case 'Home':
        this.focusTop(0);
        break;
      case 'End':
        this.focusTop(this.menus().length - 1);
        break;
      case 'Escape':
        this.leave();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  protected onMenuKey(e: KeyboardEvent): void {
    const list = this.items();
    const at = list.indexOf(e.target as HTMLElement);
    const i = this.open() ?? 0;
    switch (e.key) {
      case 'ArrowDown':
        list[(at + 1) % list.length]?.focus();
        break;
      case 'ArrowUp':
        list[(at - 1 + list.length) % list.length]?.focus();
        break;
      case 'Home':
        list[0]?.focus();
        break;
      case 'End':
        list[list.length - 1]?.focus();
        break;
      case 'ArrowRight':
        this.openMenu(i + 1);
        break;
      case 'ArrowLeft':
        this.openMenu(i - 1);
        break;
      case 'Escape':
        this.close(true);
        break;
      case 'Tab':
        this.open.set(null);
        return;
      case 'Enter':
      case ' ': {
        const row = this.rows().filter((r) => r.kind === 'item')[at];
        if (row?.kind === 'item') this.choose(row.item);
        break;
      }
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  }

  protected choose(item: Extract<ResolvedItem, { kind: 'action' }>): void {
    if (!item.enabled) return;
    this.leave();
    // after the focus is back where the action expects it
    setTimeout(() => this.actions.run(item.id), 0);
  }

  protected onDocumentPointer(e: PointerEvent): void {
    if (this.open() !== null && !this.host.nativeElement.contains(e.target as Node)) {
      this.open.set(null);
    }
  }
}
