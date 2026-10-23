import { buildMenuModel, resolveMenu, toSpec, ActionLookup } from './menu-model';

const look = (over: Partial<ActionLookup> = {}): ActionLookup => ({
  label: (id) => `L:${id}`,
  enabled: (id) => id !== 'reader.next',
  checked: (id) =>
    id === 'view.sort.path' ? true : id.startsWith('view.sort.') ? false : undefined,
  chord: (id) => (id === 'app.palette' ? 'Mod+Shift+p' : id === 'reader.next' ? 'ArrowDown' : ''),
  ...over,
});

describe('menu model', () => {
  it('has the app menu items outside macOS only', () => {
    const other = buildMenuModel('other', []).map((m) => m.label);
    const mac = buildMenuModel('mac', []).map((m) => m.label);
    expect(other).toEqual(['File', 'View', 'Category', 'Read', 'Help']);
    expect(mac).toEqual(['File', 'View', 'Category', 'Read']);
    const ids = (os: 'mac' | 'other') =>
      JSON.stringify(buildMenuModel(os, [])).match(/app\.(quit|settings|about)/g) ?? [];
    expect(ids('mac')).toEqual([]);
    expect(ids('other').sort()).toEqual(['app.about', 'app.quit', 'app.settings']);
  });

  it('lists the categories by title', () => {
    const m = buildMenuModel('other', [
      { id: 'c1', title: 'Comics' },
      { id: 'c2', title: 'Make' },
    ]);
    const cat = m[2].items;
    expect(cat[0]).toEqual({ kind: 'action', id: 'app.category.1', label: 'Comics' });
    expect(cat[1]).toEqual({ kind: 'action', id: 'app.category.2', label: 'Make' });
    expect(cat[2]).toEqual({ kind: 'separator' });
  });

  it('resolves texts, states and shortcuts; the spec drops the display text', () => {
    const r = resolveMenu(buildMenuModel('mac', []), look(), 'mac');
    const view = r[1].items;
    expect(view[0]).toMatchObject({
      id: 'app.palette',
      label: 'L:app.palette',
      accelerator: 'Mod+Shift+p',
      shortcut: '⌘⇧P',
      enabled: true,
    });
    const order = view.find((i) => i.kind === 'submenu')!;
    expect(order.kind === 'submenu' && order.items[0]).toMatchObject({ checked: true });
    const read = r[3].items[0];
    expect(read).toMatchObject({ id: 'reader.next', enabled: false, shortcut: '↓' });
    const spec = toSpec(r);
    expect(JSON.stringify(spec)).not.toContain('shortcut');
    expect(spec.menus[1].items[0]).toMatchObject({ accelerator: 'Mod+Shift+p' });
  });

  it('cleans labels for the native menu (a title with a newline must not break it, review 008 #4)', () => {
    const model = buildMenuModel('mac', [{ id: 'c1', title: 'Neu\nRoman\t' + 'x'.repeat(200) }]);
    const spec = toSpec(resolveMenu(model, look(), 'mac'));
    const cat = spec.menus[2].items.find((i) => i.kind === 'action' && i.id === 'app.category.1');
    const label = cat && cat.kind === 'action' ? cat.label : '';
    expect(label.startsWith('Neu Roman x')).toBe(true);
    // eslint-disable-next-line no-control-regex
    expect(label).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect([...label].length).toBeLessThanOrEqual(120);
  });
});
