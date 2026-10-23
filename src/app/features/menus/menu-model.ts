import { formatChord } from '../../core/actions/shortcut';
import { Os } from '../../core/actions/platform';
import { MAX_CATEGORY_ACTIONS } from '../../core/actions/action-catalog';
import { MenuItemSpec, MenuSpec } from '../../core/menu/menu-api';
import { MENUS_TEXTS } from './menus-texts';

/** One model for the native (macOS) and the HTML menu bar (design 008 E8). Pure. */
export type MenuNode =
  | { kind: 'action'; id: string; label?: string }
  | { kind: 'separator' }
  | { kind: 'submenu'; label: string; items: MenuNode[] };

export interface TopMenuNode {
  label: string;
  items: MenuNode[];
}

const a = (id: string, label?: string): MenuNode => ({ kind: 'action', id, label });
const sep: MenuNode = { kind: 'separator' };

export function buildMenuModel(os: Os, categories: { id: string; title: string }[]): TopMenuNode[] {
  const t = MENUS_TEXTS;
  // macOS: About, Settings, Quit live in the app menu Rust adds
  const file: MenuNode[] = [
    a('grid.read'),
    a('book.openExternal'),
    a('book.reveal'),
    a('book.copyPath'),
    a('book.filterSeries'),
    sep,
    a('app.generateThumbs'),
    a('app.importConfig'),
    ...(os === 'mac' ? [] : [sep, a('app.settings'), sep, a('app.quit')]),
  ];
  const view: MenuNode[] = [
    a('app.palette'),
    sep,
    a('view.focusFilter'),
    a('view.sizeUp'),
    a('view.sizeDown'),
    {
      kind: 'submenu',
      label: t.order,
      items: [a('view.sort.path'), a('view.sort.name'), a('view.sort.date'), a('view.sort.size')],
    },
    sep,
    a('view.toTop'),
    a('view.toBottom'),
    a('app.rescan'),
  ];
  const category: MenuNode[] = [
    ...categories.slice(0, MAX_CATEGORY_ACTIONS).map((c, i) => a(`app.category.${i + 1}`, c.title)),
    ...(categories.length ? [sep] : []),
    a('app.manageCategories'),
  ];
  const read: MenuNode[] = [
    a('reader.next'),
    a('reader.prev'),
    a('reader.first'),
    a('reader.last'),
    sep,
    a('reader.toggleMode'),
    a('reader.toggleFit'),
    a('reader.toggleRtl'),
    a('reader.fullscreen'),
    sep,
    a('reader.nextBook'),
    a('reader.prevBook'),
    a('reader.close'),
  ];
  const menus: TopMenuNode[] = [
    { label: t.file, items: file },
    { label: t.view, items: view },
    { label: t.category, items: category },
    { label: t.read, items: read },
  ];
  if (os !== 'mac') menus.push({ label: t.help, items: [a('app.about')] });
  return menus;
}

/** What the menus ask about an action. */
export interface ActionLookup {
  label(id: string): string;
  enabled(id: string): boolean;
  checked(id: string): boolean | undefined;
  /** First chord (canonical), `''` = none. */
  chord(id: string): string;
}

/** A resolved item: the native spec plus the shortcut text for the HTML bar. */
export type ResolvedItem =
  | (Extract<MenuItemSpec, { kind: 'action' }> & { shortcut: string })
  | { kind: 'separator' }
  | { kind: 'submenu'; label: string; items: ResolvedItem[] };

export interface ResolvedMenu {
  label: string;
  items: ResolvedItem[];
}

function resolveItems(items: MenuNode[], look: ActionLookup, os: Os): ResolvedItem[] {
  return items.map((n): ResolvedItem => {
    if (n.kind === 'separator') return n;
    if (n.kind === 'submenu') return { ...n, items: resolveItems(n.items, look, os) };
    const chord = look.chord(n.id);
    const checked = look.checked(n.id);
    return {
      kind: 'action',
      id: n.id,
      label: n.label ?? look.label(n.id),
      enabled: look.enabled(n.id),
      ...(checked === undefined ? {} : { checked }),
      ...(chord ? { accelerator: chord } : {}),
      shortcut: chord ? formatChord(chord, os) : '',
    };
  });
}

export function resolveMenu(model: TopMenuNode[], look: ActionLookup, os: Os): ResolvedMenu[] {
  return model.map((m) => ({ label: m.label, items: resolveItems(m.items, look, os) }));
}

/** The spec Rust gets (the HTML-only `shortcut` stays here). */
/** Longest label Rust accepts (`app_menu.rs`). */
const MAX_LABEL = 120;

/** Control characters out, length cut – a category title with a newline must not cost the menu. */
export function menuLabel(text: string): string {
  // eslint-disable-next-line no-control-regex
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
  return [...flat].slice(0, MAX_LABEL).join('') || '…';
}

export function toSpec(menus: ResolvedMenu[]): MenuSpec {
  const strip = (items: ResolvedItem[]): MenuItemSpec[] =>
    items.map((i) => {
      if (i.kind === 'submenu') {
        return { kind: 'submenu', label: menuLabel(i.label), items: strip(i.items) };
      }
      if (i.kind === 'separator') return i;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { shortcut, ...rest } = i;
      return { ...rest, label: menuLabel(rest.label) };
    });
  return { menus: menus.map((m) => ({ label: menuLabel(m.label), items: strip(m.items) })) };
}

/** Items that exclude each other (one category, one order) are radio items. */
export function isRadio(id: string): boolean {
  return id.startsWith('app.category.') || id.startsWith('view.sort.');
}
