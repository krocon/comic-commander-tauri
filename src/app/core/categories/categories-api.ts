import { Injectable } from '@angular/core';
import { call } from '../backend/call';
import { CategoriesConfig, CategoriesLoaded, LegacyImport } from './categories.models';

/** Typed facade of the category commands; tests bind `FakeCategoriesApi`. */
export abstract class CategoriesApi {
  abstract load(): Promise<CategoriesLoaded>;
  /** Cleans and writes; rejects with `invalid_categories`. Returns what was saved (with ids). */
  abstract save(config: CategoriesConfig): Promise<CategoriesConfig>;
  /** Native folder dialog; `null` = cancelled. */
  abstract pickFolder(start?: string): Promise<string | null>;
  /** File dialog + preview of an old `config.json`; `null` = cancelled. Saves nothing. */
  abstract importLegacy(): Promise<LegacyImport | null>;
  /** `~/Comics` if it exists. */
  abstract defaultComicsDir(): Promise<string | null>;
}

@Injectable()
export class TauriCategoriesApi extends CategoriesApi {
  load(): Promise<CategoriesLoaded> {
    return call<CategoriesLoaded>('load_categories');
  }

  save(config: CategoriesConfig): Promise<CategoriesConfig> {
    return call<CategoriesConfig>('save_categories', { config });
  }

  pickFolder(start?: string): Promise<string | null> {
    return call<string | null>('pick_folder', { start: start ?? null });
  }

  importLegacy(): Promise<LegacyImport | null> {
    return call<LegacyImport | null>('import_legacy_config');
  }

  defaultComicsDir(): Promise<string | null> {
    return call<string | null>('default_comics_dir');
  }
}
