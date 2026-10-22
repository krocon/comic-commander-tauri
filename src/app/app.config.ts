import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { AboutApi, TauriAboutApi } from './core/about/about-api';
import { CategoriesApi, TauriCategoriesApi } from './core/categories/categories-api';
import { ScanApi, TauriScanApi } from './core/scan/scan-api';

/**
 * Zoneless (Angular 22 default, no zone.js). Every backend facade is bound here; tests
 * replace them with the fakes from `src/testing/`.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: CategoriesApi, useClass: TauriCategoriesApi },
    { provide: ScanApi, useClass: TauriScanApi },
    { provide: AboutApi, useClass: TauriAboutApi },
  ],
};
