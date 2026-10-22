import { computed, inject, Injectable, signal } from '@angular/core';
import { LibraryApi } from '../../core/library/library-api';
import { LibraryScan } from '../../core/library/library.models';
import { FsError, toFsError } from '../../core/errors/fs-error';

/**
 * State of one library view (walking skeleton, prompt 001). Not `providedIn: 'root'`: the
 * component provides its own instance. Stale answers are dropped (request sequence) – a slow
 * scan of an old folder never overwrites the result of a newer one.
 */
@Injectable()
export class LibraryStore {
  private readonly api = inject(LibraryApi);
  private seq = 0;

  readonly root = signal('');
  readonly scan = signal<LibraryScan | null>(null);
  readonly loading = signal(false);
  readonly error = signal<FsError | null>(null);

  readonly books = computed(() => this.scan()?.books ?? []);

  /** Asks the backend for the default folder and scans it. */
  async init(): Promise<void> {
    try {
      this.root.set(await this.api.defaultRoot());
    } catch (e) {
      this.error.set(toFsError(e));
      return;
    }
    await this.load();
  }

  async load(root: string = this.root()): Promise<void> {
    const seq = ++this.seq;
    this.root.set(root);
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.api.scan(root);
      if (seq !== this.seq) return;
      this.scan.set(result);
    } catch (e) {
      if (seq !== this.seq) return;
      this.scan.set(null);
      this.error.set(toFsError(e));
    } finally {
      if (seq === this.seq) this.loading.set(false);
    }
  }
}
