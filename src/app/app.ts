import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CategoriesDialog } from './features/categories/categories-dialog';
import { CategoriesStore } from './features/categories/categories.store';
import { ImportDialog } from './features/categories/import-dialog';
import { CategoryView } from './features/category/category-view';
import { GenerateThumbsDialog } from './features/jobs/generate-thumbs-dialog';
import { AboutDialog } from './features/menus/about-dialog';
import { CommandPalette } from './features/menus/command-palette';
import { MenuBar } from './features/menus/menu-bar';
import { MenuService } from './features/menus/menu.service';
import { ActionService } from './core/actions/action.service';
import { KeyboardDispatcher } from './core/actions/keyboard-dispatcher';
import { AppActions } from './features/menus/app-actions';
import { DOCUMENT } from '@angular/common';
import { Reader } from './features/reader/reader';
import { ReaderService } from './features/reader/reader.service';
import { DialogService } from './shared/dialog/dialog.service';

@Component({
  selector: 'app-root',
  imports: [
    CategoryView,
    CategoriesDialog,
    ImportDialog,
    GenerateThumbsDialog,
    CommandPalette,
    AboutDialog,
    MenuBar,
    Reader,
  ],
  template: `
    @if (!mac) {
      <app-menu-bar [inert]="reader.session() !== null" />
    }
    <!-- the reader lies over the mounted category view (design 005 E6) -->
    <app-category-view class="shell" [inert]="reader.session() !== null" />
    @if (reader.session()) {
      <app-reader />
    }
    @switch (dialogs.open()) {
      @case ('categories') {
        <app-categories-dialog />
      }
      @case ('import') {
        <app-import-dialog />
      }
      @case ('thumbs') {
        <app-generate-thumbs-dialog />
      }
      @case ('palette') {
        <app-command-palette />
      }
      @case ('about') {
        <app-about-dialog />
      }
    }
  `,
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly dialogs = inject(DialogService);
  protected readonly reader = inject(ReaderService);

  private readonly actions = inject(ActionService);
  private readonly categories = inject(CategoriesStore);
  /** macOS: native menu bar (design 008 E8); elsewhere the HTML one. */
  protected readonly mac = this.actions.os === 'mac';

  constructor() {
    void this.categories.load();
    void this.reader.loadPositions();
    // the one keyboard listener (design 008): a dialog owns the keys, else reader / grid / app
    const dispatcher = inject(KeyboardDispatcher);
    dispatcher.setContextProvider((target) => {
      if (this.dialogs.open() !== null) return null;
      if (this.reader.session() !== null) return ['reader', 'global'];
      return target?.closest('app-cover-grid') ? ['grid', 'global'] : ['global'];
    });
    dispatcher.attach(inject(DOCUMENT));
    inject(AppActions).register();
    void this.actions.loadOverrides();
    inject(MenuService).start();
  }
}
