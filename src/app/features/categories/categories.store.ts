import { computed, inject, Injectable, signal } from '@angular/core';
import { CategoriesApi } from '../../core/categories/categories-api';
import {
  CategoriesConfig,
  Category,
  ConfigWarning,
  LegacyImport,
} from '../../core/categories/categories.models';
import { FsError, toFsError } from '../../core/errors/fs-error';
import { DialogService } from '../../shared/dialog/dialog.service';
import { newCategory } from './category-form';

const EMPTY: CategoriesConfig = { version: 1, activeId: null, categories: [] };

/**
 * The categories of the app (root): what `categories.json` holds, the active category, the
 * dialogs to manage and import them (design 002). Saving always goes through the backend,
 * which cleans the config and assigns ids – the store keeps what came back.
 */
@Injectable({ providedIn: 'root' })
export class CategoriesStore {
  private readonly api = inject(CategoriesApi);
  private readonly dialogs = inject(DialogService);

  readonly config = signal<CategoriesConfig>(EMPTY);
  readonly loaded = signal(false);
  readonly warning = signal<ConfigWarning | null>(null);
  /** Last error of load/save/import (shown in the dialogs and the empty state). */
  readonly error = signal<FsError | null>(null);
  readonly importPreview = signal<LegacyImport | null>(null);
  /** `~/Comics`, if it exists – offered on the first start. */
  readonly comicsDir = signal<string | null>(null);

  readonly categories = computed(() => this.config().categories);
  readonly active = computed<Category | null>(() => {
    const c = this.config();
    return c.categories.find((x) => x.id === c.activeId) ?? null;
  });

  async load(): Promise<void> {
    try {
      const loaded = await this.api.load();
      this.config.set(loaded.config);
      this.warning.set(loaded.warning);
      if (loaded.config.categories.length === 0) {
        this.comicsDir.set(await this.api.defaultComicsDir());
      }
    } catch (e) {
      this.error.set(toFsError(e));
    } finally {
      this.loaded.set(true);
    }
  }

  /** Saves through the backend; `false` (and `error`) if it refused. */
  async save(config: CategoriesConfig): Promise<boolean> {
    try {
      this.config.set(await this.api.save(config));
      this.error.set(null);
      return true;
    } catch (e) {
      this.error.set(toFsError(e));
      return false;
    }
  }

  select(id: string): Promise<boolean> {
    if (id === this.config().activeId) return Promise.resolve(true);
    return this.save({ ...this.config(), activeId: id });
  }

  /** Adds a category for `baseDir` and makes it the active one (first start). */
  async addFolder(baseDir: string): Promise<boolean> {
    const before = new Set(this.categories().map((c) => c.id));
    const ok = await this.save({
      ...this.config(),
      categories: [...this.categories(), newCategory(baseDir)],
    });
    const added = this.categories().find((c) => !before.has(c.id));
    return ok && added ? this.select(added.id) : ok;
  }

  pickFolder(start?: string): Promise<string | null> {
    return this.api.pickFolder(start).catch((e) => {
      this.error.set(toFsError(e));
      return null;
    });
  }

  openManage(): void {
    this.error.set(null);
    this.dialogs.show('categories');
  }

  /** File dialog, then the import preview (nothing is saved yet). */
  async startImport(): Promise<void> {
    this.error.set(null);
    try {
      const preview = await this.api.importLegacy();
      if (!preview) return;
      this.importPreview.set(preview);
      this.dialogs.show('import');
    } catch (e) {
      this.error.set(toFsError(e));
    }
  }

  /** Appends the chosen categories of the preview and saves. */
  async addImported(categories: Category[]): Promise<boolean> {
    const ok = await this.save({
      ...this.config(),
      categories: [...this.categories(), ...categories.map((c) => ({ ...c, id: '' }))],
    });
    if (ok) {
      this.importPreview.set(null);
      this.dialogs.close();
    }
    return ok;
  }

  closeDialog(): void {
    this.importPreview.set(null);
    this.dialogs.close();
  }
}
