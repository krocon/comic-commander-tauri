import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AboutApi } from '../../core/about/about-api';
import { AppInfo } from '../../core/about/about.models';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Modal } from '../../shared/dialog/modal';
import { MENUS_TEXTS } from './menus-texts';

/** About (design 008 E10): logo (public/logo.svg = docs/logo-5farbig.svg), name, version, platform, licence, source. */
@Component({
  selector: 'app-about-dialog',
  imports: [Modal],
  template: `
    <app-modal [heading]="t.aboutTitle" width="28rem" (closed)="dialogs.close()">
      <div class="head">
        <img class="logo" src="logo.svg" alt="" width="64" height="64" />
        <p class="intro">{{ t.aboutText }}</p>
      </div>
      <dl>
        <dt>{{ t.version }}</dt>
        <dd>{{ info()?.version ?? '–' }}</dd>
        <dt>{{ t.platform }}</dt>
        <dd>{{ info() ? info()!.os + ' · ' + info()!.arch : '–' }}</dd>
        <dt>{{ t.license }}</dt>
        <dd>{{ t.licenseText }}</dd>
        <dt>{{ t.source }}</dt>
        <dd class="url">https://github.com/krocon/comic-commander-tauri</dd>
      </dl>
      <div class="footer">
        <button type="button" class="btn primary" data-autofocus (click)="dialogs.close()">
          {{ t.close }}
        </button>
      </div>
    </app-modal>
  `,
  styles: `
    .head {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .logo {
      flex: none;
      width: 4rem;
      height: 4rem;
    }
    .intro {
      margin: 0;
    }
    dl {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: var(--space-1) var(--space-3);
      margin: 0;
    }
    dt {
      color: var(--color-text-muted);
    }
    dd {
      margin: 0;
    }
    .url {
      overflow-wrap: anywhere;
      user-select: text;
    }
    .footer {
      display: flex;
      justify-content: flex-end;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AboutDialog {
  protected readonly dialogs = inject(DialogService);
  protected readonly t = MENUS_TEXTS;
  protected readonly info = signal<AppInfo | null>(null);

  constructor() {
    inject(AboutApi)
      .appInfo()
      .then((i) => this.info.set(i))
      .catch(() => undefined);
  }
}
