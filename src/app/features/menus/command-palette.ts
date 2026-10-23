import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActionService } from '../../core/actions/action.service';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Modal } from '../../shared/dialog/modal';
import { MENUS_TEXTS } from './menus-texts';

interface Entry {
  id: string;
  label: string;
  shortcut: string;
}

const key = (s: string) => s.normalize('NFC').toLowerCase();

/** All words of the query appear in the label (or the id). Pure. */
export function matches(entry: { id: string; label: string }, query: string): boolean {
  const hay = key(`${entry.label} ${entry.id}`);
  return key(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

/**
 * Command palette (design 008 E1, `Mod+Shift+P`): every action the app offers right now, with
 * its shortcut; type to narrow, ↑/↓, Enter runs (APG combobox with a listbox). The dialog
 * closes first – the action runs where the focus was.
 */
@Component({
  selector: 'app-command-palette',
  imports: [Modal],
  template: `
    <app-modal [heading]="t.paletteTitle" width="34rem" (closed)="dialogs.close()">
      <input
        class="input query"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded="true"
        aria-controls="palette-list"
        spellcheck="false"
        autocomplete="off"
        data-autofocus
        [attr.aria-label]="t.paletteTitle"
        [attr.aria-activedescendant]="entries().length ? 'palette-' + active() : null"
        [placeholder]="t.palettePlaceholder"
        [value]="query()"
        (input)="onInput($event)"
        (keydown)="onKey($event)"
      />
      <ul id="palette-list" role="listbox" class="list" [attr.aria-label]="t.paletteTitle">
        @for (e of entries(); track e.id; let i = $index) {
          <!-- options of a combobox: the input keeps the focus (aria-activedescendant), keys are there -->
          <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
          <li
            role="option"
            [id]="'palette-' + i"
            [attr.aria-selected]="i === active()"
            [class.active]="i === active()"
            (pointerdown)="$event.preventDefault()"
            (click)="run(e.id)"
          >
            <span>{{ e.label }}</span>
            <kbd>{{ e.shortcut }}</kbd>
          </li>
        } @empty {
          <li class="empty" role="presentation">{{ t.paletteEmpty }}</li>
        }
      </ul>
    </app-modal>
  `,
  styleUrl: './command-palette.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommandPalette {
  protected readonly dialogs = inject(DialogService);
  private readonly actions = inject(ActionService);
  protected readonly t = MENUS_TEXTS;
  protected readonly query = signal('');
  protected readonly active = signal(0);

  /** Taken when the palette opens (it is a dialog: grid/reader actions stay as they were). */
  private readonly all: Entry[] = this.actions
    .registered()
    .map((id) => ({ id, def: this.actions.def(id) }))
    .filter(
      ({ id, def }) =>
        def && def.palette !== false && id !== 'app.palette' && this.actions.enabled(id),
    )
    .map(({ id, def }) => ({ id, label: def!.label, shortcut: this.actions.shortcut(id) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'en'));

  protected readonly entries = computed(() => this.all.filter((e) => matches(e, this.query())));

  protected onInput(e: Event): void {
    this.query.set((e.target as HTMLInputElement).value);
    this.active.set(0);
  }

  protected onKey(e: KeyboardEvent): void {
    const n = this.entries().length;
    switch (e.key) {
      case 'ArrowDown':
        if (n) this.active.update((i) => (i + 1) % n);
        break;
      case 'ArrowUp':
        if (n) this.active.update((i) => (i - 1 + n) % n);
        break;
      case 'Home':
        this.active.set(0);
        break;
      case 'End':
        this.active.set(Math.max(0, n - 1));
        break;
      case 'Enter': {
        const entry = this.entries()[this.active()];
        if (entry) this.run(entry.id);
        break;
      }
      default:
        return;
    }
    e.preventDefault();
  }

  protected run(id: string): void {
    this.dialogs.close();
    // the focus is back first (the dialog service restores it in a task)
    setTimeout(() => this.actions.run(id), 0);
  }
}
