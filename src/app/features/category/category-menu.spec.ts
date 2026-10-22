import { TestBed } from '@angular/core/testing';
import { CategoriesApi } from '../../core/categories/categories-api';
import { FakeCategoriesApi } from '../../../testing/fake-categories-api';
import { category, config } from '../../../testing/fixtures';
import { DialogService } from '../../shared/dialog/dialog.service';
import { CategoriesStore } from '../categories/categories.store';
import { CategoryMenu } from './category-menu';

const flush = () => new Promise((r) => setTimeout(r));

async function render() {
  TestBed.configureTestingModule({
    imports: [CategoryMenu],
    providers: [{ provide: CategoriesApi, useClass: FakeCategoriesApi }],
  });
  const api = TestBed.inject(CategoriesApi) as FakeCategoriesApi;
  api.loaded = {
    config: config([category('c1'), category('c2', { title: 'Make' })]),
    warning: null,
  };
  const store = TestBed.inject(CategoriesStore);
  await store.load();
  const fixture = TestBed.createComponent(CategoryMenu);
  document.body.appendChild(fixture.nativeElement);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const update = async () => {
    await fixture.whenStable();
    await flush();
  };
  const key = (target: Element, k: string) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  return { el, store, update, key, fixture };
}

describe('CategoryMenu', () => {
  it('opens with ArrowDown on the checked item and chooses with Enter', async () => {
    const { el, store, update, key } = await render();
    const button = el.querySelector('.menu-button') as HTMLButtonElement;
    expect(button.getAttribute('aria-expanded')).toBe('false');
    key(button, 'ArrowDown');
    await update();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.getAttribute('aria-checked')).toBe('true');
    key(document.activeElement!, 'ArrowDown');
    await update();
    expect(document.activeElement?.textContent).toContain('Make');
    key(document.activeElement!, 'Enter');
    await update();
    expect(store.active()?.id).toBe('c2');
    expect(el.querySelector('[role=menu]')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('Escape closes, End reaches „Import old config…“, Manage opens the dialog', async () => {
    const { el, update, key } = await render();
    const button = el.querySelector('.menu-button') as HTMLButtonElement;
    button.click();
    await update();
    key(document.activeElement!, 'Escape');
    await update();
    expect(el.querySelector('[role=menu]')).toBeNull();
    button.click();
    await update();
    key(document.activeElement!, 'End');
    await update();
    expect(document.activeElement?.textContent).toContain('Import old config');
    key(document.activeElement!, 'ArrowUp');
    await update();
    key(document.activeElement!, ' ');
    await update();
    expect(TestBed.inject(DialogService).open()).toBe('categories');
  });

  it('marks the active category', async () => {
    const { el, update } = await render();
    (el.querySelector('.menu-button') as HTMLButtonElement).click();
    await update();
    const checked = [...el.querySelectorAll('[role=menuitemradio]')].map((x) =>
      x.getAttribute('aria-checked'),
    );
    expect(checked).toEqual(['true', 'false']);
    expect(el.querySelectorAll('[role=menuitem]').length).toBe(2);
  });
});
