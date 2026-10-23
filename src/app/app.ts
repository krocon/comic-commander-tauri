import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CategoriesDialog } from './features/categories/categories-dialog';
import { CategoriesStore } from './features/categories/categories.store';
import { ImportDialog } from './features/categories/import-dialog';
import { CategoryView } from './features/category/category-view';
import { GenerateThumbsDialog } from './features/jobs/generate-thumbs-dialog';
import { Reader } from './features/reader/reader';
import { ReaderService } from './features/reader/reader.service';
import { DialogService } from './shared/dialog/dialog.service';

@Component({
  selector: 'app-root',
  imports: [CategoryView, CategoriesDialog, ImportDialog, GenerateThumbsDialog, Reader],
  template: `
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
    }
  `,
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly dialogs = inject(DialogService);
  protected readonly reader = inject(ReaderService);

  constructor() {
    void inject(CategoriesStore).load();
    void this.reader.loadPositions();
  }
}
