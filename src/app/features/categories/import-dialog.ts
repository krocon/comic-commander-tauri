import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Category, LegacyImport } from '../../core/categories/categories.models';
import { describeFsError } from '../../core/errors/fs-error';
import { Modal } from '../../shared/dialog/modal';
import { CategoriesStore } from './categories.store';
import { CATEGORIES_TEXTS } from './categories-texts';

const EMPTY: LegacyImport = { file: '', categories: [], notes: [] };

/**
 * Preview of an old `config.json` (design 002 E7): one row per category with a checkbox –
 * duplicates start unticked. „Add selected“ appends and saves.
 */
@Component({
  selector: 'app-import-dialog',
  imports: [Modal],
  templateUrl: './import-dialog.html',
  styleUrl: './import-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportDialog {
  protected readonly store = inject(CategoriesStore);
  protected readonly t = CATEGORIES_TEXTS;
  protected readonly preview = this.store.importPreview() ?? EMPTY;
  protected readonly checked = signal<boolean[]>(
    this.preview.categories.map(
      (_, i) => !this.preview.notes.some((n) => n.index === i && n.code === 'duplicate'),
    ),
  );
  protected readonly skipped = this.preview.notes.filter((n) => n.index === null);
  protected readonly chosen = computed(() =>
    this.preview.categories.filter((_, i) => this.checked()[i]),
  );
  protected readonly errorText = computed(() => {
    const e = this.store.error();
    return e ? describeFsError(e) : '';
  });

  protected notesOf(index: number): string {
    return this.preview.notes
      .filter((n) => n.index === index)
      .map((n) => this.t.note(n))
      .join(' ');
  }

  protected sizes(c: Category): string {
    return c.thumbsDims.map((d) => `${d.width}×${d.height}`).join(', ');
  }

  protected toggle(i: number, on: boolean): void {
    this.checked.update((list) => list.map((v, k) => (k === i ? on : v)));
  }

  protected add(): void {
    void this.store.addImported(this.chosen());
  }
}
