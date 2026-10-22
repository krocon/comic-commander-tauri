import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CategoriesDialog } from './features/categories/categories-dialog';
import { CategoriesStore } from './features/categories/categories.store';
import { ImportDialog } from './features/categories/import-dialog';
import { CategoryView } from './features/category/category-view';
import { DialogService } from './shared/dialog/dialog.service';

@Component({
  selector: 'app-root',
  imports: [CategoryView, CategoriesDialog, ImportDialog],
  template: `
    <app-category-view class="shell" />
    @switch (dialogs.open()) {
      @case ('categories') {
        <app-categories-dialog />
      }
      @case ('import') {
        <app-import-dialog />
      }
    }
  `,
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly dialogs = inject(DialogService);

  constructor() {
    void inject(CategoriesStore).load();
  }
}
