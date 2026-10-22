import { Injectable } from '@angular/core';
import { CoversApi, coverPath, coverVersion } from '../app/core/covers/covers-api';
import { BookEntry } from '../app/core/scan/scan.models';

/** Test double of `CoversApi` (never import in app code). */
@Injectable()
export class FakeCoversApi extends CoversApi {
  coverUrl(categoryId: string, book: BookEntry, dimIndex: number): string {
    return `fake-cover:${coverPath(categoryId, book, dimIndex)}${coverVersion(book)}`;
  }
}
