import { inject, Injectable } from '@angular/core';
import { MAX_CATEGORY_ACTIONS } from '../../core/actions/action-catalog';
import { ActionService } from '../../core/actions/action.service';
import { MenuApi } from '../../core/menu/menu-api';
import { DialogService } from '../../shared/dialog/dialog.service';
import { CategoriesStore } from '../categories/categories.store';
import { ReaderService } from '../reader/reader.service';

/**
 * The app-wide actions (design 008): palette, dialogs, categories 1…n, about, quit. Registered
 * once by the root component (and by tests).
 */
@Injectable({ providedIn: 'root' })
export class AppActions {
  private readonly actions = inject(ActionService);
  private readonly dialogs = inject(DialogService);
  private readonly categories = inject(CategoriesStore);
  private readonly reader = inject(ReaderService);
  private readonly menu = inject(MenuApi);
  private done = false;

  register(): void {
    if (this.done) return;
    this.done = true;
    const c = this.categories;
    const dialogs = this.dialogs;
    // not while reading: the reader covers the grid
    const idle = () => this.reader.session() === null;
    this.actions.registerAll({
      'app.palette': { run: () => dialogs.show('palette') },
      'app.manageCategories': { run: () => c.openManage(), enabled: idle },
      'app.importConfig': { run: () => void c.startImport(), enabled: idle },
      'app.generateThumbs': { run: () => dialogs.show('thumbs'), enabled: idle },
      // settings follow with prompt 009
      'app.settings': { run: () => undefined, enabled: () => false },
      'app.about': { run: () => dialogs.show('about') },
      'app.quit': { run: () => void this.menu.quit().catch(() => undefined) },
    });
    for (let n = 1; n <= MAX_CATEGORY_ACTIONS; n++) {
      this.actions.register(`app.category.${n}`, {
        run: () => {
          const cat = c.categories()[n - 1];
          if (cat) void c.select(cat.id);
        },
        enabled: () => idle() && c.categories().length >= n,
        checked: () => c.categories()[n - 1]?.id === c.config().activeId,
      });
    }
  }
}
