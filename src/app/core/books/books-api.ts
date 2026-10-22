import { Injectable } from '@angular/core';
import { call } from '../backend/call';

/**
 * Typed facade of `open_book_external` / `reveal_book` (design 004 E5). A book is named by
 * category id + book id only; Rust finds the path in its registry.
 */
export abstract class BooksApi {
  abstract openExternal(categoryId: string, bookId: string): Promise<void>;
  abstract reveal(categoryId: string, bookId: string): Promise<void>;
}

@Injectable()
export class TauriBooksApi extends BooksApi {
  openExternal(categoryId: string, bookId: string): Promise<void> {
    return call<void>('open_book_external', { categoryId, bookId });
  }

  reveal(categoryId: string, bookId: string): Promise<void> {
    return call<void>('reveal_book', { categoryId, bookId });
  }
}
