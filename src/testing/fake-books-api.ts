import { Injectable } from '@angular/core';
import { BooksApi } from '../app/core/books/books-api';
import { FsError } from '../app/core/errors/fs-error';

/** Test double of `BooksApi` (never import in app code): records the calls. */
@Injectable()
export class FakeBooksApi extends BooksApi {
  readonly calls: string[] = [];
  failWith: FsError | null = null;

  openExternal(categoryId: string, bookId: string): Promise<void> {
    return this.record(`open ${categoryId}.${bookId}`);
  }

  reveal(categoryId: string, bookId: string): Promise<void> {
    return this.record(`reveal ${categoryId}.${bookId}`);
  }

  private record(call: string): Promise<void> {
    this.calls.push(call);
    return this.failWith ? Promise.reject(this.failWith) : Promise.resolve();
  }
}
