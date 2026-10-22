import { computed, inject, Injectable, signal } from '@angular/core';
import { FsError, toFsError } from '../../core/errors/fs-error';
import { ScanApi } from '../../core/scan/scan-api';
import { BookEntry, ScanEvent, ScanStats } from '../../core/scan/scan.models';
import { sortBooks } from './book-order';

export type ScanPhase = 'idle' | 'scanning' | 'done' | 'cancelled' | 'failed';

/** Batches are sorted on arrival up to this size; larger lists once at `done`. */
export const SORT_WHILE_SCANNING = 5000;

/**
 * The books of one category view (design 002). Not `providedIn: 'root'`: the view provides its
 * own instance. Driven by the events of `open_category`; events of an older `open` are dropped
 * (request sequence) – switching the category never mixes two scans.
 */
@Injectable()
export class CategoryStore {
  private readonly api = inject(ScanApi);
  private seq = 0;
  /**
   * Parts of the cache until `complete` (design 004: ≤ 2000 books per message). Shown at once in
   * the order of Rust (natural, nearly the display order), sorted for display when complete.
   */
  private cacheParts: BookEntry[] = [];

  readonly categoryId = signal<string | null>(null);
  readonly books = signal<BookEntry[]>([]);
  readonly phase = signal<ScanPhase>('idle');
  /** The books shown came from the cache and are not confirmed by a scan yet. */
  readonly fromCache = signal(false);
  readonly firstScan = signal(false);
  readonly scannedAt = signal<number | null>(null);
  readonly stats = signal<ScanStats | null>(null);
  readonly progress = signal<{ books: number; dirs: number } | null>(null);
  readonly error = signal<FsError | null>(null);
  readonly cacheKept = signal(false);

  readonly scanning = computed(() => this.phase() === 'scanning');

  /** Opens a category; the same id again = scan again without clearing the list. */
  async open(id: string | null): Promise<void> {
    const seq = ++this.seq;
    this.cacheParts = [];
    if (id !== this.categoryId()) {
      this.books.set([]);
      this.scannedAt.set(null);
      this.stats.set(null);
      this.fromCache.set(false);
    }
    this.categoryId.set(id);
    this.error.set(null);
    this.cacheKept.set(false);
    this.progress.set(null);
    if (!id) {
      this.phase.set('idle');
      return;
    }
    this.phase.set('scanning');
    try {
      await this.api.open(id, (event) => this.apply(seq, event));
    } catch (e) {
      if (seq !== this.seq) return;
      this.error.set(toFsError(e));
      this.phase.set('failed');
    }
  }

  rescan(): Promise<void> {
    return this.open(this.categoryId());
  }

  async cancel(): Promise<void> {
    const id = this.categoryId();
    if (id && this.scanning()) await this.api.cancel(id);
  }

  /** Shows the parts so far; the whole cache sorted once. */
  private takeCache(complete: boolean): void {
    if (complete) {
      this.books.set(sortBooks(this.cacheParts));
      this.cacheParts = [];
    } else {
      this.books.set([...this.cacheParts]);
    }
  }

  private apply(seq: number, e: ScanEvent): void {
    if (seq !== this.seq) return;
    switch (e.kind) {
      case 'cached':
        this.cacheParts = [...e.books];
        this.scannedAt.set(e.scannedAt);
        this.stats.set(e.stats);
        this.fromCache.set(true);
        this.takeCache(e.complete);
        break;
      case 'cachedMore':
        this.cacheParts.push(...e.books);
        this.takeCache(e.complete);
        break;
      case 'started':
        this.firstScan.set(e.firstScan);
        this.phase.set('scanning');
        if (e.firstScan) this.books.set([]);
        break;
      case 'batch': {
        const all = [...this.books(), ...e.books];
        this.books.set(all.length <= SORT_WHILE_SCANNING ? sortBooks(all) : all);
        break;
      }
      case 'progress':
        this.progress.set({ books: e.books, dirs: e.dirs });
        break;
      case 'diff': {
        const removed = new Set(e.removed);
        const changed = new Map(e.changed.map((b) => [b.path, b]));
        const kept = this.books()
          .filter((b) => !removed.has(b.path))
          .map((b) => changed.get(b.path) ?? b);
        this.books.set(sortBooks([...kept, ...e.added]));
        break;
      }
      case 'done':
        if (this.firstScan() && this.books().length > SORT_WHILE_SCANNING) {
          this.books.set(sortBooks(this.books()));
        }
        this.scannedAt.set(e.scannedAt);
        this.stats.set(e.stats);
        this.fromCache.set(false);
        this.progress.set(null);
        this.phase.set('done');
        break;
      case 'cancelled':
        this.progress.set(null);
        this.phase.set('cancelled');
        break;
      case 'failed':
        this.error.set(e.error);
        this.cacheKept.set(e.cacheKept);
        this.progress.set(null);
        this.phase.set('failed');
        break;
    }
  }
}
