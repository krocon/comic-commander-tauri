import { TestBed } from '@angular/core/testing';
import { CategoriesApi } from '../../core/categories/categories-api';
import { FakeCategoriesApi } from '../../../testing/fake-categories-api';
import { category, config } from '../../../testing/fixtures';
import { DialogService } from '../../shared/dialog/dialog.service';
import { CategoriesDialog } from './categories-dialog';
import { CategoriesStore } from './categories.store';

const flush = () => new Promise((r) => setTimeout(r));

async function render(
  cats = [category('c1'), category('c2', { title: 'Make', bookExtensions: ['.pdf'] })],
) {
  TestBed.configureTestingModule({
    imports: [CategoriesDialog],
    providers: [{ provide: CategoriesApi, useClass: FakeCategoriesApi }],
  });
  const api = TestBed.inject(CategoriesApi) as FakeCategoriesApi;
  api.loaded = { config: config(cats), warning: null };
  const store = TestBed.inject(CategoriesStore);
  await store.load();
  const dialogs = TestBed.inject(DialogService);
  dialogs.show('categories');
  const fixture = TestBed.createComponent(CategoriesDialog);
  document.body.appendChild(fixture.nativeElement);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const update = async () => {
    await fixture.whenStable();
    await flush();
  };
  const input = (sel: string, value: string) => {
    const i = el.querySelector(sel) as HTMLInputElement;
    i.value = value;
    i.dispatchEvent(new Event('input'));
  };
  const button = (label: string) =>
    [...el.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === label,
    ) as HTMLButtonElement;
  return { el, api, store, dialogs, update, input, button };
}

describe('CategoriesDialog', () => {
  it('is a modal dialog with the categories as listbox', async () => {
    const { el } = await render();
    const dialog = el.querySelector('[role=dialog]');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    const options = [...el.querySelectorAll('[role=option]')].map((o) => o.textContent?.trim());
    expect(options).toEqual(['Title c1', 'Make']);
    expect(el.querySelector('[role=option][aria-selected=true]')?.textContent).toContain(
      'Title c1',
    );
  });

  it('edits title and file types and saves', async () => {
    const { el, api, dialogs, update, input, button } = await render();
    input('#cat-title', 'Comics');
    const pdf = [...el.querySelectorAll('.checks label')].find(
      (l) => l.textContent?.trim() === '.pdf',
    );
    (pdf?.querySelector('input') as HTMLInputElement).click();
    await update();
    button('Save').click();
    await update();
    const saved = api.saved.at(-1)!;
    expect(saved.categories[0].title).toBe('Comics');
    expect(saved.categories[0].bookExtensions).toEqual(['.cbz', '.cbr', '.pdf']);
    expect(dialogs.open()).toBeNull();
  });

  it('blocks saving while a category is invalid', async () => {
    const { el, api, update, input, button } = await render();
    input('#cat-folder', '  ');
    await update();
    expect(el.textContent).toContain('Please choose a folder.');
    expect(button('Save').disabled).toBe(true);
    expect(api.saved.length).toBe(0);
  });

  it('add, choose folder, move with Alt+ArrowUp, remove', async () => {
    const { el, api, store, update, button } = await render();
    button('Add').click();
    await update();
    button('Choose…').click();
    await update();
    expect((el.querySelector('#cat-folder') as HTMLInputElement).value).toBe('/picked/folder');
    const list = el.querySelector('[role=listbox]') as HTMLElement;
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true }));
    await update();
    expect([...el.querySelectorAll('[role=option]')].map((o) => o.textContent?.trim())).toEqual([
      'Title c1',
      '/picked/folder',
      'Make',
    ]);
    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }));
    await update();
    button('Remove').click();
    await update();
    button('Save').click();
    await update();
    expect(api.saved.at(-1)!.categories.map((c) => c.baseDir)).toEqual([
      '/comics/c1',
      '/picked/folder',
    ]);
    expect(store.categories().length).toBe(2);
  });

  it('thumbnail sizes: default, add, remove, range check', async () => {
    const { el, api, update, button } = await render();
    button('Add size').click();
    await update();
    expect(el.querySelectorAll('.size').length).toBe(3);
    const width = el.querySelectorAll('.size input[type=number]')[4] as HTMLInputElement;
    width.value = '10';
    width.dispatchEvent(new Event('input'));
    await update();
    expect(el.textContent).toContain('32 to 2000');
    width.value = '300';
    width.dispatchEvent(new Event('input'));
    (el.querySelectorAll('.size input[type=radio]')[2] as HTMLInputElement).click();
    await update();
    button('Save').click();
    await update();
    const c = api.saved.at(-1)!.categories[0];
    expect(c.thumbsDims.length).toBe(3);
    expect(c.dimIndex).toBe(2);
  });

  it('Escape with changes asks first', async () => {
    const { el, dialogs, update, input } = await render();
    input('#cat-title', 'changed');
    await update();
    el.querySelector('[role=dialog]')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await update();
    expect(el.textContent).toContain('Discard your changes?');
    expect(dialogs.open()).toBe('categories');
  });

  it('shows the backend error and stays open', async () => {
    const { el, api, dialogs, update, button } = await render();
    api.saveError = { code: 'invalid_categories', message: 'category 0: folder is not absolute' };
    button('Save').click();
    await update();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('could not be saved');
    expect(dialogs.open()).toBe('categories');
  });

  it('first start: begins with a new category', async () => {
    const { el } = await render([]);
    expect(el.querySelectorAll('[role=option]').length).toBe(1);
    expect((el.querySelector('#cat-folder') as HTMLInputElement).value).toBe('');
  });
});
