import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FitMode, ZOOM_CYCLE, ZoomMode } from './reader-logic';
import { READER_TEXTS } from './reader-texts';

export interface ZoomChoice {
  mode: FitMode;
  label: string;
  /** Shortcut as the OS shows it (from the keymap). */
  key: string;
  icon: string;
}

/**
 * Zoom modes in a narrow toolbar (design 014 E10): one icon with a menu (WAI-ARIA APG „menu
 * button“, `menuitemradio`) – like `CategoryMenu`. ↓/Enter/Space open, ↑/↓/Home/End move,
 * Enter/Space choose, Esc closes (focus back), Tab or a click outside closes.
 */
@Component({
  selector: 'app-zoom-menu',
  templateUrl: './zoom-menu.html',
  styleUrl: './zoom-menu.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:pointerdown)': 'onDocumentPointer($event)' },
})
export class ZoomMenu {
  readonly mode = input.required<ZoomMode>();
  readonly choices = input.required<readonly ZoomChoice[]>();
  readonly chosen = output<FitMode>();
  /** The menu opened or closed (the toolbar stays while it is open). */
  readonly openChange = output<boolean>();

  protected readonly t = READER_TEXTS;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  protected readonly open = signal(false);
  protected readonly focused = signal(0);
  protected readonly current = computed(
    () => this.choices().find((c) => c.mode === this.mode()) ?? null,
  );

  protected toggle(): void {
    if (this.open()) this.close(true);
    else this.show(false);
  }

  protected onButtonKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      this.show(false);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      this.show(true);
    }
  }

  protected onMenuKey(event: KeyboardEvent): void {
    const n = this.choices().length;
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
        this.choose(i);
        break;
      case 'Escape':
        this.close(true);
        break;
      case 'Tab':
        this.close(false);
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  /** Enter on an item: consumed here (else WebKit activates the button again, design 002). */
  protected onItemEnter(event: Event, i: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.choose(i);
  }

  protected itemId(i: number): string {
    return `zoom-menu-item-${i}`;
  }

  protected choose(i: number): void {
    const c = this.choices()[i];
    this.close(true);
    if (c) this.chosen.emit(c.mode);
  }

  protected onDocumentPointer(event: PointerEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close(false);
  }

  private show(last: boolean): void {
    const checked = this.choices().findIndex((c) => c.mode === this.mode());
    this.open.set(true);
    this.openChange.emit(true);
    this.focus(last ? this.choices().length - 1 : Math.max(0, checked));
  }

  private focus(i: number): void {
    this.focused.set(i);
    setTimeout(() =>
      this.host.nativeElement.querySelector<HTMLElement>(`#${this.itemId(i)}`)?.focus(),
    );
  }

  private close(focusButton: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    this.openChange.emit(false);
    if (focusButton) {
      setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('.menu-button')?.focus());
    }
  }
}

/** The four fits in toolbar order (icons from Font Awesome 4.5; full size is a text icon). */
export const ZOOM_ICONS: Record<FitMode, string> = {
  width: 'fa-arrows-h',
  height: 'fa-arrows-v',
  page: 'fa-file-o',
  full: '',
};
export const ZOOM_ORDER = ZOOM_CYCLE;
