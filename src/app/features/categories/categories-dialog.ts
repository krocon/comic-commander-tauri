import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Category, ThumbsDim } from '../../core/categories/categories.models';
import { describeFsError } from '../../core/errors/fs-error';
import { Modal } from '../../shared/dialog/modal';
import { CategoriesStore } from './categories.store';
import { CATEGORIES_TEXTS } from './categories-texts';
import {
  ICONS,
  MAX_DIMS,
  SUPPORTED_EXTENSIONS,
  move,
  newCategory,
  validateCategory,
} from './category-form';

/**
 * Dialog „Manage categories“ (design 002): list on the left (listbox, Alt+↑/↓ moves), form on
 * the right. Works on a draft; only „Save“ writes (through the backend). `Mod+Enter` saves,
 * `Esc` cancels – with a question when something changed.
 */
@Component({
  selector: 'app-categories-dialog',
  imports: [Modal],
  templateUrl: './categories-dialog.html',
  styleUrl: './categories-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown)': 'onKeydown($event)' },
})
export class CategoriesDialog {
  protected readonly store = inject(CategoriesStore);
  protected readonly t = CATEGORIES_TEXTS;
  protected readonly extensions = SUPPORTED_EXTENSIONS;
  protected readonly icons = ICONS;
  protected readonly maxDims = MAX_DIMS;

  private readonly original = structuredClone(this.store.categories());
  /** Without any category the dialog starts with a new one (first start). */
  protected readonly draft = signal<Category[]>(
    this.original.length ? structuredClone(this.original) : [newCategory()],
  );
  protected readonly selected = signal(this.initialSelection());
  protected readonly confirmDiscard = signal(false);
  protected readonly saving = signal(false);

  protected readonly current = computed<Category | null>(
    () => this.draft()[this.selected()] ?? null,
  );
  protected readonly problems = computed(() => {
    const c = this.current();
    return c ? validateCategory(c) : [];
  });
  protected readonly invalidIndexes = computed(
    () => new Set(this.draft().flatMap((c, i) => (validateCategory(c).length ? [i] : []))),
  );
  protected readonly dirty = computed(
    () => JSON.stringify(this.draft()) !== JSON.stringify(this.original),
  );
  protected readonly errorText = computed(() => {
    const e = this.store.error();
    return e ? describeFsError(e) : '';
  });

  private initialSelection(): number {
    const i = this.original.findIndex((c) => c.id === this.store.config().activeId);
    return Math.max(0, i);
  }

  protected optionId(i: number): string {
    return `cat-option-${i}`;
  }

  protected label(c: Category): string {
    return c.title.trim() || c.baseDir.trim() || this.t.untitled;
  }

  protected problemsOf(field: string): string[] {
    return [
      ...new Set(
        this.problems()
          .filter((p) => p.field === field)
          .map((p) => this.t.problem(p.code)),
      ),
    ];
  }

  protected update(patch: Partial<Category>): void {
    const i = this.selected();
    this.draft.update((list) => list.map((c, k) => (k === i ? { ...c, ...patch } : c)));
    this.confirmDiscard.set(false);
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected toggleExtension(ext: string, on: boolean): void {
    const c = this.current();
    if (!c) return;
    const set = new Set(c.bookExtensions);
    if (on) set.add(ext);
    else set.delete(ext);
    // keep the order of the supported list
    this.update({ bookExtensions: this.extensions.filter((e) => set.has(e)) });
  }

  protected updateDim(index: number, patch: Partial<ThumbsDim>): void {
    const c = this.current();
    if (!c) return;
    this.update({ thumbsDims: c.thumbsDims.map((d, k) => (k === index ? { ...d, ...patch } : d)) });
  }

  protected number(event: Event): number {
    const v = (event.target as HTMLInputElement).value.trim();
    return v === '' ? Number.NaN : Number(v);
  }

  protected addDim(): void {
    const c = this.current();
    if (!c || c.thumbsDims.length >= MAX_DIMS) return;
    this.update({ thumbsDims: [...c.thumbsDims, { width: 400, height: 600, nameExtension: '' }] });
  }

  protected removeDim(index: number): void {
    const c = this.current();
    if (!c || c.thumbsDims.length <= 1) return;
    const thumbsDims = c.thumbsDims.filter((_, k) => k !== index);
    const dimIndex = c.dimIndex === index ? 0 : c.dimIndex > index ? c.dimIndex - 1 : c.dimIndex;
    this.update({ thumbsDims, dimIndex });
  }

  protected add(): void {
    this.draft.update((list) => [...list, newCategory()]);
    this.selected.set(this.draft().length - 1);
    this.confirmDiscard.set(false);
  }

  protected remove(): void {
    const i = this.selected();
    this.draft.update((list) => list.filter((_, k) => k !== i));
    this.selected.set(Math.max(0, Math.min(i, this.draft().length - 1)));
  }

  protected moveSelected(delta: number): void {
    const from = this.selected();
    const to = from + delta;
    if (to < 0 || to >= this.draft().length) return;
    this.draft.set(move(this.draft(), from, to));
    this.selected.set(to);
  }

  protected async chooseFolder(): Promise<void> {
    const c = this.current();
    const picked = await this.store.pickFolder(c?.baseDir || undefined);
    if (picked) this.update({ baseDir: picked });
  }

  protected onListKeydown(event: KeyboardEvent): void {
    const n = this.draft().length;
    if (n === 0) return;
    const i = this.selected();
    let next: number | null = null;
    if (event.altKey && event.key === 'ArrowUp') this.moveSelected(-1);
    else if (event.altKey && event.key === 'ArrowDown') this.moveSelected(1);
    else if (event.key === 'ArrowUp') next = Math.max(0, i - 1);
    else if (event.key === 'ArrowDown') next = Math.min(n - 1, i + 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = n - 1;
    else return;
    event.preventDefault();
    if (next !== null) this.selected.set(next);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void this.save();
    }
  }

  protected async save(): Promise<void> {
    if (this.invalidIndexes().size > 0 || this.saving()) return;
    this.saving.set(true);
    const draft = this.draft();
    const activeId = this.store.config().activeId;
    const ok = await this.store.save({
      version: 1,
      activeId: draft.some((c) => c.id === activeId) ? activeId : null,
      categories: draft,
    });
    this.saving.set(false);
    if (ok) this.store.closeDialog();
  }

  /** Esc, backdrop or „Cancel“: ask once if something changed. */
  protected cancel(): void {
    if (this.dirty() && !this.confirmDiscard()) {
      this.confirmDiscard.set(true);
      return;
    }
    this.store.closeDialog();
  }

  /** Only without unsaved changes (the import saves at once). */
  protected async importOld(): Promise<void> {
    if (!this.dirty()) await this.store.startImport();
  }
}
