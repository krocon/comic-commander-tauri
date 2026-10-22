import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { LibraryApi, TauriLibraryApi } from './core/library/library-api';
import { AboutApi, TauriAboutApi } from './core/about/about-api';

/**
 * Zoneless (Angular 22 default, no zone.js). Every backend facade is bound here; tests
 * replace them with the fakes from `src/testing/`.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: LibraryApi, useClass: TauriLibraryApi },
    { provide: AboutApi, useClass: TauriAboutApi },
  ],
};
