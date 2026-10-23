import { Injectable, signal } from '@angular/core';

/** The modal dialogs of the app (one at a time). */
export type DialogKind = 'categories' | 'import' | 'thumbs' | 'palette' | 'about';

/**
 * Which modal dialog is open. Remembers the focused element on `show` and gives the focus back
 * on `close` (as in files-and-folders `dialog.service.ts`).
 */
@Injectable({ providedIn: 'root' })
export class DialogService {
  readonly open = signal<DialogKind | null>(null);
  private returnFocus: HTMLElement | null = null;

  show(kind: DialogKind): void {
    if (this.open() === null) {
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      this.returnFocus = active instanceof HTMLElement ? active : null;
    }
    this.open.set(kind);
  }

  close(options?: { restoreFocus?: boolean }): void {
    this.open.set(null);
    const target = options?.restoreFocus === false ? null : this.returnFocus;
    this.returnFocus = null;
    if (target?.isConnected) {
      setTimeout(() => target.focus());
    }
  }
}
