import { Injectable } from '@angular/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { BookEntry } from '../scan/scan.models';

/** The scheme of the cover thumbnails (Rust `cover::SCHEME`, design 003 E1). */
export const COVER_SCHEME = 'cccover';

/**
 * Path part of a cover URL: `<category id>.<book id>.<dimIndex>` – ids from the backend, no
 * file path. Rust serves only books its scan listed.
 */
export function coverPath(categoryId: string, book: BookEntry, dimIndex: number): string {
  return `${categoryId}.${book.id}.${dimIndex}`;
}

/** `?v=<mtime>`: a changed book gets a new URL, the WebView cache stays valid otherwise. */
export function coverVersion(book: BookEntry): string {
  return `?v=${book.modifiedMs ?? 0}`;
}

/** Facade of the cover thumbnails; tests bind `FakeCoversApi`. */
export abstract class CoversApi {
  abstract coverUrl(categoryId: string, book: BookEntry, dimIndex: number): string;
}

@Injectable()
export class TauriCoversApi extends CoversApi {
  coverUrl(categoryId: string, book: BookEntry, dimIndex: number): string {
    // the right form per OS: cccover://localhost/… or http://cccover.localhost/… (Windows)
    return convertFileSrc(coverPath(categoryId, book, dimIndex), COVER_SCHEME) + coverVersion(book);
  }
}
