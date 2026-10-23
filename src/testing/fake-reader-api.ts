import { Injectable } from '@angular/core';
import { ReaderApi } from '../app/core/reader/reader-api';
import { FsError } from '../app/core/errors/fs-error';
import { OpenedBook, ReaderEvent, ReadingPosition } from '../app/core/reader/reader.models';

/** Test double of `ReaderApi` (never import in app code): books by id, records the calls. */
@Injectable()
export class FakeReaderApi extends ReaderApi {
  readonly calls: string[] = [];
  /** Answers of `open` per book id (default: 10 pages without sizes). */
  readonly books = new Map<string, OpenedBook | FsError>();
  /** The event listener of the last `open`. */
  emit: (event: ReaderEvent) => void = () => undefined;
  positions: Record<string, ReadingPosition> = {};
  fullscreen = false;
  /** Pending `open`s are resolved by hand when set. */
  hold = false;
  private held: (() => void)[] = [];
  private seq = 0;

  open(
    categoryId: string,
    bookId: string,
    onEvent: (event: ReaderEvent) => void,
  ): Promise<OpenedBook> {
    this.calls.push(`open ${categoryId}.${bookId}`);
    this.emit = onEvent;
    const answer = this.books.get(bookId) ?? pagesBook(10, `t${++this.seq}`);
    const settle = (ok: (b: OpenedBook) => void, fail: (e: FsError) => void) =>
      'token' in answer ? ok(structuredClone(answer)) : fail(answer);
    return new Promise((resolve, reject) => {
      if (this.hold) this.held.push(() => settle(resolve, reject));
      else settle(resolve, reject);
    });
  }

  release(): void {
    const h = this.held;
    this.held = [];
    h.forEach((f) => f());
  }

  close(token: string): Promise<void> {
    this.calls.push(`close ${token}`);
    return Promise.resolve();
  }

  pageUrl(token: string, index: number, width: number, retry = 0): string {
    return `page:${token}/${index}/${width}${retry ? `?retry=${retry}` : ''}`;
  }

  savePosition(
    categoryId: string,
    bookId: string,
    page: number,
    pages: number,
    rotation = 0,
  ): Promise<void> {
    // the rotation only shows when the book is turned (keeps the 005 expectations short)
    this.calls.push(
      `save ${categoryId}.${bookId} ${page}/${pages}${rotation ? ` r${rotation}` : ''}`,
    );
    this.positions[bookId] = { page, pages, updatedMs: 0, rotation };
    return Promise.resolve();
  }

  loadReadingState(): Promise<Record<string, ReadingPosition>> {
    return Promise.resolve({ ...this.positions });
  }

  toggleFullscreen(): Promise<boolean> {
    this.fullscreen = !this.fullscreen;
    this.calls.push(`fullscreen ${this.fullscreen}`);
    return Promise.resolve(this.fullscreen);
  }
}

/** A book of `n` pages (`p1.jpg` …). */
export function pagesBook(
  n: number,
  token = 'token0123456789a',
  overrides: Partial<OpenedBook> = {},
): OpenedBook {
  return {
    token,
    pages: Array.from({ length: n }, (_, i) => ({
      name: `p${i + 1}.jpg`,
      size: 1000,
      width: null,
      height: null,
    })),
    lastPage: null,
    rotation: 0,
    extracting: false,
    ...overrides,
  };
}
