import { TestBed } from '@angular/core/testing';
import { ZoomChoice, ZoomMenu } from './zoom-menu';
import { FitMode, ZoomMode } from './reader-logic';

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));

const CHOICES: ZoomChoice[] = [
  { mode: 'width', label: 'Fit width', key: '1', icon: 'fa-arrows-h' },
  { mode: 'height', label: 'Fit height', key: '2', icon: 'fa-arrows-v' },
  { mode: 'page', label: 'Fit page', key: '3', icon: 'fa-file-o' },
  { mode: 'full', label: 'Full size', key: '⌘0', icon: '' },
];

async function setup(mode: ZoomMode = 'page') {
  const fixture = TestBed.createComponent(ZoomMenu);
  fixture.componentRef.setInput('mode', mode);
  fixture.componentRef.setInput('choices', CHOICES);
  const chosen: FitMode[] = [];
  const open: boolean[] = [];
  fixture.componentInstance.chosen.subscribe((m) => chosen.push(m));
  fixture.componentInstance.openChange.subscribe((o) => open.push(o));
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const button = el.querySelector('.menu-button') as HTMLButtonElement;
  const key = async (target: Element, k: string) => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    fixture.detectChanges();
    await wait();
  };
  return { fixture, el, button, chosen, open, key };
}

afterEach(() => document.body.replaceChildren());

describe('ZoomMenu (APG menu button, design 014 E10)', () => {
  it('names the current mode and opens on the checked item', async () => {
    const { el, button, key, open } = await setup('page');
    expect(button.getAttribute('aria-label')).toBe('Zoom mode: Fit page');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await key(button, 'ArrowDown');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(open).toEqual([true]);
    const items = [...el.querySelectorAll('[role=menuitemradio]')];
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'true',
      'false',
    ]);
    expect(document.activeElement).toBe(items[2]);
    expect(items[3].textContent).toContain('1:1');
    expect(items[3].querySelector('kbd')!.textContent).toBe('⌘0');
  });

  it('moves with the arrows, chooses with Enter, closes with Esc', async () => {
    const { el, button, key, chosen, open } = await setup('width');
    await key(button, 'Enter');
    const menu = el.querySelector('[role=menu]')!;
    await key(menu, 'ArrowDown');
    await key(menu, 'End');
    expect(document.activeElement!.id).toBe('zoom-menu-item-3');
    (document.activeElement as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
    await wait(5);
    expect(chosen).toEqual(['full']);
    expect(el.querySelector('[role=menu]')).toBeNull();
    expect(document.activeElement).toBe(button);
    await key(button, 'ArrowUp');
    await key(el.querySelector('[role=menu]')!, 'Escape');
    await wait(5);
    expect(el.querySelector('[role=menu]')).toBeNull();
    expect(open).toEqual([true, false, true, false]);
  });

  it('shows a neutral icon for a free zoom', async () => {
    const { button } = await setup('custom');
    expect(button.getAttribute('aria-label')).toBe('Zoom mode: Custom zoom');
    expect(button.querySelector('.fa-search')).not.toBeNull();
  });
});
