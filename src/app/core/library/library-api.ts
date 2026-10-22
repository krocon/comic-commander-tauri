import { Injectable } from '@angular/core';
import { call } from '../backend/call';
import { LibraryScan } from './library.models';

/**
 * Typed facade of the library commands. Components and stores never call `invoke()`
 * themselves; tests bind `FakeLibraryApi` (src/testing) instead.
 */
export abstract class LibraryApi {
  /** `~/Comics` if it exists, else the home folder. */
  abstract defaultRoot(): Promise<string>;
  /** Scans `root` recursively for comic books. Rejects with an `FsError`. */
  abstract scan(root: string): Promise<LibraryScan>;
}

@Injectable()
export class TauriLibraryApi extends LibraryApi {
  defaultRoot(): Promise<string> {
    return call<string>('default_library_root');
  }

  scan(root: string): Promise<LibraryScan> {
    return call<LibraryScan>('scan_library', { root });
  }
}
