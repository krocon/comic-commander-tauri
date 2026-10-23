import { computed, effect, inject, Injectable, Injector, untracked } from '@angular/core';
import { ActionService } from '../../core/actions/action.service';
import { MenuApi } from '../../core/menu/menu-api';
import { CategoriesStore } from '../categories/categories.store';
import { buildMenuModel, resolveMenu, ResolvedMenu, toSpec } from './menu-model';

/** Pause before the native menu is rebuilt after a change (states, categories). */
const NATIVE_DEBOUNCE_MS = 150;

/**
 * The menus of the app (design 008 E8): one resolved model from the catalog, the registered
 * actions and the categories. On macOS it becomes the native menu bar (rebuilt when a state
 * changes) and its clicks come back as actions; elsewhere the HTML menu bar draws it.
 */
@Injectable({ providedIn: 'root' })
export class MenuService {
  private readonly actions = inject(ActionService);
  private readonly api = inject(MenuApi);
  private readonly categories = inject(CategoriesStore);
  private readonly injector = inject(Injector);
  private started = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  readonly menus = computed<ResolvedMenu[]>(() => {
    const os = this.actions.os;
    const model = buildMenuModel(
      os,
      this.categories.categories().map((c) => ({ id: c.id, title: c.title })),
    );
    return resolveMenu(
      model,
      {
        label: (id) => this.actions.def(id)?.label ?? id,
        enabled: (id) => this.actions.enabled(id),
        checked: (id) => this.actions.checked(id),
        chord: (id) => this.actions.chords(id)[0] ?? '',
      },
      os,
    );
  });

  /** Native menu (macOS) and its clicks; call once at start. */
  start(): void {
    if (this.started) return;
    this.started = true;
    void this.api.onAction((id) => this.actions.run(id));
    if (this.actions.os !== 'mac') return;
    effect(
      () => {
        const spec = toSpec(this.menus());
        untracked(() => {
          clearTimeout(this.timer);
          this.timer = setTimeout(
            () => void this.api.setAppMenu(spec).catch((e) => console.warn('menu', e)),
            NATIVE_DEBOUNCE_MS,
          );
        });
      },
      { injector: this.injector },
    );
  }
}
