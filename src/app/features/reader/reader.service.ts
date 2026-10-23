import { inject, Injectable, signal } from '@angular/core';
import { ReaderApi } from '../../core/reader/reader-api';
import { ReadingPosition } from '../../core/reader/reader.models';
import { BookEntry } from '../../core/scan/scan.models';

/** What the reader shows: a book of a list (the grid's filtered order, for `]` / `[`). */
export interface ReaderSession {
  categoryId: string;
  books: readonly BookEntry[];
  index: number;
}

/**
 * The open reader (design 005 E6): a root service instead of a route – the reader lies over the
 * category view, which stays mounted, so „back“ needs no restoring. Also holds the reading
 * positions of all books for the progress bars of the grid (E5).
 */
@Injectable({ providedIn: 'root' })
export class ReaderService {
  private readonly api = inject(ReaderApi);

  readonly session = signal<ReaderSession | null>(null);
  /** The book the reader was closed on – the grid puts its cursor there (a new object each time). */
  readonly closedOn = signal<{ bookId: string } | null>(null);
  /** Reading positions per book id. */
  readonly positions = signal<Readonly<Record<string, ReadingPosition>>>({});

  async loadPositions(): Promise<void> {
    try {
      this.positions.set(await this.api.loadReadingState());
    } catch {
      // without positions the grid shows no bars – nothing else depends on them
    }
  }

  open(categoryId: string, books: readonly BookEntry[], index: number): void {
    if (index < 0 || index >= books.length) return;
    this.session.set({ categoryId, books: [...books], index });
  }

  /** The book `delta` places further in the list; `false` at the ends. */
  move(delta: 1 | -1): boolean {
    const s = this.session();
    if (!s) return false;
    const index = s.index + delta;
    if (index < 0 || index >= s.books.length) return false;
    this.session.set({ ...s, index });
    return true;
  }

  close(): void {
    const s = this.session();
    if (!s) return;
    this.session.set(null);
    const book = s.books[s.index];
    if (book) this.closedOn.set({ bookId: book.id });
  }

  /** A position just saved (the bar in the grid follows at once). */
  remember(bookId: string, page: number, pages: number): void {
    this.positions.update((p) => ({ ...p, [bookId]: { page, pages, updatedMs: Date.now() } }));
  }
}
