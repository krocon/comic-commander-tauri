import { TestBed } from '@angular/core/testing';
import { AboutApi } from '../../core/about/about-api';
import { ActionService } from '../../core/actions/action.service';
import { OS } from '../../core/actions/platform';
import { CategoriesApi } from '../../core/categories/categories-api';
import { FakeCategoriesApi } from '../../../testing/fake-categories-api';
import { category, config } from '../../../testing/fixtures';
import { DialogService } from '../../shared/dialog/dialog.service';
import { CategoriesStore } from '../categories/categories.store';
import { AboutDialog } from './about-dialog';
import { CommandPalette, matches } from './command-palette';
import { MenuBar } from './menu-bar';

const flush = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function setup() {
  TestBed.configureTestingModule({
    providers: [
      { provide: OS, useValue: 'other' },
      { provide: CategoriesApi, useClass: FakeCategoriesApi },
      {
        provide: AboutApi,
        useValue: {
          appInfo: () =>
            Promise.resolve({ name: 'cc', version: '0.1.0', os: 'linux', arch: 'x86_64' }),
        },
      },
    ],
  });
  (TestBed.inject(CategoriesApi) as FakeCategoriesApi).loaded = {
    config: config([category('c1', { title: 'Comics' }), category('c2', { title: 'Make' })]),
    warning: null,
  };
  await TestBed.inject(CategoriesStore).load();
  const actions = TestBed.inject(ActionService);
  const ran: string[] = [];
  const reg = (id: string, extra: { enabled?: () => boolean; checked?: () => boolean } = {}) =>
    actions.register(id, { run: () => ran.push(id), ...extra });
  return { actions, ran, reg };
}

function key(target: Element, k: string, init: KeyboardEventInit = {}) {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }),
  );
}

describe('MenuBar (APG menubar)', () => {
  it('enters with F10, moves, opens, runs and gives the focus back', async () => {
    const { actions, ran, reg } = await setup();
    reg('app.palette');
    reg('app.about');
    reg('view.sort.path', { checked: () => true });
    reg('grid.read', { enabled: () => false });
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const fixture = TestBed.createComponent(MenuBar);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role=menubar]')).not.toBeNull();
    const tops = () => [...el.querySelectorAll<HTMLElement>('[role=menubar] > .top > button')];
    expect(tops().map((b) => b.textContent!.trim())).toEqual([
      'File',
      'View',
      'Category',
      'Read',
      'Help',
    ]);
    actions.run('app.focusMenu');
    await flush();
    expect(document.activeElement).toBe(tops()[0]);
    key(tops()[0], 'ArrowRight');
    await flush();
    expect(document.activeElement).toBe(tops()[1]);
    key(tops()[1], 'ArrowDown');
    fixture.detectChanges();
    await flush();
    const first = document.activeElement as HTMLElement;
    expect(first.textContent).toContain('Command palette');
    expect(first.textContent).toContain('Ctrl+Shift+P');
    // the order radio items are checkboxes with a state
    const checked = el.querySelector('[role=menuitemcheckbox][aria-checked=true]');
    expect(checked?.textContent).toContain('Order: folder and name');
    key(first, 'Enter');
    await flush(5);
    expect(ran).toEqual(['app.palette']);
    expect(el.querySelector('[role=menu]')).toBeNull();
    expect(document.activeElement).toBe(outside);
    // disabled items do not run
    tops()[0].click();
    fixture.detectChanges();
    await flush();
    (el.querySelector('[role=menuitem][aria-disabled=true]') as HTMLElement).click();
    await flush(5);
    expect(ran).toEqual(['app.palette']);
    // categories by title, the active one checked
    tops()[2].click();
    fixture.detectChanges();
    await flush();
    expect(el.querySelector('[role=menu]')!.textContent).toContain('Comics');
    key(document.activeElement!, 'Escape');
    fixture.detectChanges();
    await flush();
    expect(document.activeElement).toBe(tops()[2]);
    fixture.nativeElement.remove();
    outside.remove();
  });
});

describe('CommandPalette', () => {
  it('matches all words', () => {
    expect(matches({ id: 'reader.next', label: 'Next page' }, 'nex pag')).toBe(true);
    expect(matches({ id: 'reader.next', label: 'Next page' }, 'reader')).toBe(true);
    expect(matches({ id: 'reader.next', label: 'Next page' }, 'prev')).toBe(false);
  });

  it('lists enabled actions with shortcuts and runs the chosen one', async () => {
    const { ran, reg } = await setup();
    reg('app.about');
    reg('app.rescan');
    reg('grid.left');
    reg('app.settings', { enabled: () => false });
    TestBed.inject(DialogService).show('palette');
    const fixture = TestBed.createComponent(CommandPalette);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
    await flush();
    const el = fixture.nativeElement as HTMLElement;
    const options = () =>
      [...el.querySelectorAll('[role=option]')].map((o) => o.textContent!.trim());
    expect(options()).toEqual(['About Comic Commander', 'Scan category againCtrl+R']);
    const input = el.querySelector('input')!;
    expect(document.activeElement).toBe(input);
    input.value = 'scan';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(options().length).toBe(1);
    key(input, 'Enter');
    await flush(5);
    expect(ran).toEqual(['app.rescan']);
    expect(TestBed.inject(DialogService).open()).toBeNull();
    fixture.nativeElement.remove();
  });
});

describe('AboutDialog', () => {
  it('shows version, platform and licence', async () => {
    await setup();
    const fixture = TestBed.createComponent(AboutDialog);
    await fixture.whenStable();
    await flush();
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent!;
    expect(text).toContain('0.1.0');
    expect(text).toContain('linux · x86_64');
    expect(text).toContain('MIT');
  });
});
