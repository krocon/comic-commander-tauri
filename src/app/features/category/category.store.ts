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
  /** A rescan of the shown category: its parts are collected silently (review 004 #2). */
  private replacing = false;
  /** Diff parts until `done` – applied and sorted once (review 004 #4). */
  private pendingDiff: { added: BookEntry[]; removed: string[]; changed: BookEntry[] } | null =
    null;

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
    this.pendingDiff = null;
    this.replacing = id === this.categoryId() && this.books().length > 0;
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

  /** The collected diff parts in one step (one sort). */
  private applyDiff(): void {
    const d = this.pendingDiff;
    this.pendingDiff = null;
    if (!d) return;
    const removed = new Set(d.removed);
    const changed = new Map(d.changed.map((b) => [b.path, b]));
    const kept = this.books()
      .filter((b) => !removed.has(b.path))
      .map((b) => changed.get(b.path) ?? b);
    this.books.set(sortBooks([...kept, ...d.added]));
  }

  /** Shows the parts so far; the whole cache sorted once. */
  private takeCache(complete: boolean): void {
    if (complete) {
      this.books.set(sortBooks(this.cacheParts));
      this.cacheParts = [];
    } else if (!this.replacing) {
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
        // after `done` (a late opener's parts, review 004 #8) the list is always sorted
        const sort = all.length <= SORT_WHILE_SCANNING || this.phase() === 'done';
        this.books.set(sort ? sortBooks(all) : all);
        break;
      }
      case 'progress':
        this.progress.set({ books: e.books, dirs: e.dirs });
        break;
      case 'diff': {
        if (!e.added.length && !e.removed.length && !e.changed.length) break;
        const d = (this.pendingDiff ??= { added: [], removed: [], changed: [] });
        d.added.push(...e.added);
        d.removed.push(...e.removed);
        d.changed.push(...e.changed);
        break;
      }
      case 'done':
        this.applyDiff();
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
