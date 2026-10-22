import { ChangeDetectionStrategy, Component } from '@angular/core';
import { LibraryView } from './features/library/library-view';

@Component({
  selector: 'app-root',
  imports: [LibraryView],
  template: `<app-library-view class="shell" />`,
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
