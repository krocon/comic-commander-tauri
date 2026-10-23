import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { book } from '../../../testing/fixtures';
import { BookAction, BookMenu } from './book-menu';
import { GridItem } from './grouping';

@Component({
  imports: [BookMenu],
  template: `<app-book-menu
    [item]="item()"
    [x]="10"
    [y]="20"
    (chosen)="chosen.set($event)"
    (closed)="closed.set(true)"
  />`,
})
class Host {
  readonly b = book('x.cbz', { name: 'Hägar <b>1</b>.cbz' });
  readonly item = signal<GridItem>({ kind: 'book', id: this.b.id, book: this.b });
  readonly chosen = signal<BookAction | null>(null);
  readonly closed = signal(false);
}

async function render() {
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const items = () => [...el.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  // keys go to the focused item, like in the browser
  const key = (k: string) =>
    (document.activeElement ?? el).dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true }),
    );
  return { host: fixture.componentInstance, el, items, key };
}

describe('BookMenu', () => {
  it('starts on the first enabled action, moves and chooses by keyboard', async () => {
    const { host, el, items, key } = await render();
    expect(el.querySelector('[role="menu"]')!.getAttribute('aria-label')).toBe(
      'Actions for Hägar <b>1</b>.cbz',
    );
    expect(items()[0].getAttribute('aria-disabled')).toBeNull();
    expect(document.activeElement).toBe(items()[0]);
    key('ArrowDown');
    key('ArrowDown');
    expect(document.activeElement).toBe(items()[2]);
    key('Enter');
    expect(host.chosen()).toBe('reveal');
    key('Home');
    key(' ');
    expect(host.chosen()).toBe('read'); // PDF too since prompt 006
    key('End');
    key('Enter');
    expect(host.chosen()).toBe('copy');
  });

  it('closes with Escape and a click outside', async () => {
    const { host, key } = await render();
    key('Escape');
    expect(host.closed()).toBe(true);
    host.closed.set(false);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(host.closed()).toBe(true);
  });

  it('a group: open, read first unread, filter series – no file actions (design 011)', async () => {
    const fixture = TestBed.createComponent(Host);
    const cover = book('A/Asterix 01.cbz');
    fixture.componentInstance.item.set({
      kind: 'group',
      group: 'series',
      id: 's:asterix',
      key: 'asterix',
      label: 'Asterix',
      cover,
      count: 2,
      total: 2,
      read: 0,
      progress: null,
      newestMs: 0,
    });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[role="menu"]')!.getAttribute('aria-label')).toBe(
      'Actions for Asterix',
    );
    const labels = [...el.querySelectorAll('[role="menuitem"] span')].map((i) => i.textContent);
    expect(labels).toEqual(['Open', 'Read first unread', 'Filter series']);
  });
});
