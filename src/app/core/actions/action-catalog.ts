/**
 * Every function of the app as an action (design 008): id, text, context. Shortcuts are in
 * the keymaps (`keymap.*.json`), handlers are registered by the views (`ActionService`).
 * Texts here (English = source; German follows in prompt 009).
 */
export type ActionContext = 'global' | 'grid' | 'reader';

export interface ActionDef {
  id: string;
  label: string;
  context: ActionContext;
  /** Held key repeats the action (cursor, pages); else once per press. */
  repeat?: boolean;
  /** Shown in the command palette (cursor moves are not). */
  palette?: boolean;
}

/** Categories reachable by action (and the first nine by `Mod+1…9`). */
export const MAX_CATEGORY_ACTIONS = 30;

const G = (id: string, label: string, extra: Partial<ActionDef> = {}): ActionDef => ({
  id,
  label,
  context: 'global',
  ...extra,
});
const grid = (id: string, label: string, extra: Partial<ActionDef> = {}): ActionDef => ({
  id,
  label,
  context: 'grid',
  ...extra,
});
const reader = (id: string, label: string, extra: Partial<ActionDef> = {}): ActionDef => ({
  id,
  label,
  context: 'reader',
  ...extra,
});
const move = { repeat: true, palette: false };

export const ACTIONS: readonly ActionDef[] = [
  // app
  G('app.palette', 'Command palette…'),
  ...Array.from({ length: MAX_CATEGORY_ACTIONS }, (_, i) =>
    G(`app.category.${i + 1}`, `Category ${i + 1}`, { palette: false }),
  ),
  G('app.manageCategories', 'Manage categories…'),
  G('app.importConfig', 'Import old config…'),
  G('app.generateThumbs', 'Generate thumbnails…'),
  G('app.settings', 'Settings…'),
  G('app.about', 'About Comic Commander'),
  G('app.quit', 'Quit'),
  G('app.rescan', 'Scan category again'),
  G('app.focusMenu', 'Menu bar', { palette: false }),
  // view (grid toolbar)
  G('view.focusFilter', 'Filter'),
  // views (design 011)
  G('view.mode.flat', 'View: all books'),
  G('view.mode.series', 'View: series'),
  G('view.mode.folders', 'View: folders'),
  // looks (design 015)
  G('view.look.grid', 'Look: grid'),
  G('view.look.shelf', 'Look: shelf'),
  G('view.look.toggle', 'Switch grid / shelf'),
  G('view.sizeUp', 'Bigger covers', { repeat: true }),
  G('view.sizeDown', 'Smaller covers', { repeat: true }),
  G('view.sort.path', 'Order: folder and name'),
  G('view.sort.name', 'Order: file name'),
  G('view.sort.series', 'Order: series and number'),
  G('view.sort.date', 'Order: newest first'),
  G('view.sort.size', 'Order: largest first'),
  G('view.toTop', 'To the top'),
  G('view.toBottom', 'To the bottom'),
  // grid
  grid('grid.left', 'Cursor left', move),
  grid('grid.right', 'Cursor right', move),
  grid('grid.up', 'Cursor up', move),
  grid('grid.down', 'Cursor down', move),
  grid('grid.pageUp', 'Page up', move),
  grid('grid.pageDown', 'Page down', move),
  grid('grid.home', 'First book', { palette: false }),
  grid('grid.end', 'Last book', { palette: false }),
  grid('grid.read', 'Read'),
  grid('grid.menu', 'Actions for the book…', { palette: false }),
  grid('grid.escape', 'Clear filter', { palette: false }),
  grid('grid.levelUp', 'Up one level'),
  grid('book.openExternal', 'Open with default app'),
  grid('book.reveal', revealText()),
  grid('book.filterSeries', 'Filter series'),
  grid('book.copyPath', 'Copy path'),
  // reader
  reader('reader.next', 'Next page', move),
  reader('reader.prev', 'Previous page', move),
  reader('reader.right', 'Page to the right', move),
  reader('reader.left', 'Page to the left', move),
  reader('reader.first', 'First page'),
  reader('reader.last', 'Last page'),
  reader('reader.rightEnd', 'Last page to the right', { palette: false }),
  reader('reader.leftEnd', 'Last page to the left', { palette: false }),
  reader('reader.toggleMode', 'Single page / continuous'),
  // zoom and rotation (design 014)
  reader('reader.zoom.width', 'Fit width'),
  reader('reader.zoom.height', 'Fit height'),
  reader('reader.zoom.page', 'Fit page'),
  reader('reader.zoom.full', 'Full size'),
  reader('reader.zoom.next', 'Next zoom mode'),
  reader('reader.zoom.prev', 'Previous zoom mode'),
  reader('reader.zoomIn', 'Zoom in', { repeat: true }),
  reader('reader.zoomOut', 'Zoom out', { repeat: true }),
  reader('reader.toggleZoomSlider', 'Show zoom slider'),
  reader('reader.rotateLeft', 'Rotate left'),
  reader('reader.rotateRight', 'Rotate right'),
  reader('reader.toggleToolbar', 'Always show toolbar'),
  reader('reader.toggleRtl', 'Right to left (manga)'),
  reader('reader.fullscreen', 'Full screen'),
  reader('reader.nextBook', 'Next book'),
  reader('reader.prevBook', 'Previous book'),
  reader('reader.close', 'Back to the covers'),
];

const BY_ID = new Map(ACTIONS.map((a) => [a.id, a] as const));

export function actionDef(id: string): ActionDef | undefined {
  return BY_ID.get(id);
}

function revealText(): string {
  const p = typeof navigator === 'undefined' ? '' : navigator.platform;
  if (p.startsWith('Mac')) return 'Show in Finder';
  if (p.startsWith('Win')) return 'Show in Explorer';
  return 'Show in file manager';
}
