import { Injectable } from '@angular/core';
import { CategoriesApi } from '../app/core/categories/categories-api';
import {
  CategoriesConfig,
  CategoriesLoaded,
  LegacyImport,
} from '../app/core/categories/categories.models';
import { config } from './fixtures';

/** Test double of `CategoriesApi` (never import in app code). */
@Injectable()
export class FakeCategoriesApi extends CategoriesApi {
  loaded: CategoriesLoaded = { config: config([]), warning: null };
  readonly saved: CategoriesConfig[] = [];
  saveError: unknown = null;
  pickResult: string | null = '/picked/folder';
  importResult: LegacyImport | null = null;
  comicsDir: string | null = null;
  private seq = 0;

  load(): Promise<CategoriesLoaded> {
    return Promise.resolve(structuredClone(this.loaded));
  }

  /** Like Rust: assigns ids and titles, keeps `activeId` valid. */
  save(cfg: CategoriesConfig): Promise<CategoriesConfig> {
    if (this.saveError) return Promise.reject(this.saveError);
    const categories = cfg.categories.map((c) => ({
      ...c,
      id: c.id || `c${String(++this.seq).padStart(12, '0')}`,
      title: c.title || 'Folder',
    }));
    const activeId = categories.some((c) => c.id === cfg.activeId)
      ? cfg.activeId
      : (categories[0]?.id ?? null);
    const saved = { version: 1, activeId, categories };
    this.saved.push(saved);
    return Promise.resolve(structuredClone(saved));
  }

  pickFolder(): Promise<string | null> {
    return Promise.resolve(this.pickResult);
  }

  importLegacy(): Promise<LegacyImport | null> {
    return Promise.resolve(this.importResult);
  }

  defaultComicsDir(): Promise<string | null> {
    return Promise.resolve(this.comicsDir);
  }
}
