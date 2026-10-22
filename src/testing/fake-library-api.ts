import { Injectable } from '@angular/core';
import { LibraryApi } from '../app/core/library/library-api';
import { LibraryScan } from '../app/core/library/library.models';

interface Pending {
  root: string;
  resolve: (scan: LibraryScan) => void;
  reject: (error: unknown) => void;
}

/**
 * Test double of `LibraryApi` (never import in app code). Scans stay pending until the test
 * answers them – so ordering and stale answers can be tested.
 */
@Injectable()
export class FakeLibraryApi extends LibraryApi {
  defaultRootValue = '/home/test/Comics';
  readonly pending: Pending[] = [];

  defaultRoot(): Promise<string> {
    return Promise.resolve(this.defaultRootValue);
  }

  scan(root: string): Promise<LibraryScan> {
    return new Promise((resolve, reject) => this.pending.push({ root, resolve, reject }));
  }
}
