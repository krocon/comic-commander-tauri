import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { LibraryStore } from './library.store';
import { LIBRARY_TEXTS } from './library-texts';
import { describeFsError } from '../../core/errors/fs-error';

/** Rows rendered by the plain list of the skeleton (the cover grid of prompt 004 virtualises). */
export const MAX_LIST_ROWS = 500;

/**
 * Walking skeleton (prompt 001): folder field → `scan_library` → list of books.
 * Replaced by the cover grid (prompt 004).
 */
@Component({
  selector: 'app-library-view',
  templateUrl: './library-view.html',
  styleUrl: './library-view.css',
  providers: [LibraryStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibraryView implements OnInit {
  protected readonly store = inject(LibraryStore);
  protected readonly t = LIBRARY_TEXTS;

  protected readonly shown = computed(() => this.store.books().slice(0, MAX_LIST_ROWS));
  protected readonly hidden = computed(() =>
    Math.max(0, this.store.books().length - MAX_LIST_ROWS),
  );
  protected readonly errorText = computed(() => {
    const e = this.store.error();
    return e ? describeFsError(e) : '';
  });

  ngOnInit(): void {
    void this.store.init();
  }

  protected submit(event: Event, value: string): void {
    event.preventDefault();
    void this.store.load(value);
  }
}
