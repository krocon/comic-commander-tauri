import { SORT_MODES, SortMode } from '../category/book-order';
import { VIEW_MODES, ViewMode } from './grouping';

/**
 * What the grid remembers per category (design 004 E9, E10): filter, size, order and position
 * (book ids, not pixels). In `localStorage` – a per-viewer convenience, nothing is lost when it
 * is empty or broken; moves into the settings (Rust) with prompt 009.
 *
 * v2 (design 011): view (flat / series / folders) and level; `focusId`/`topId` are tile ids
 * (book id or group id). A v1 state is read with the flat view.
 * v3 (design 015): the look (grid / shelf); v1 and v2 are read with the grid.
 */

/** How the tiles are drawn (design 015): covers edge to edge, or books on a wooden shelf. */
export type Look = 'grid' | 'shelf';
export const LOOKS: readonly Look[] = ['grid', 'shelf'];

export interface ViewState {
  filter: string;
  dimIndex: number;
  sort: SortMode;
  /** Book with the keyboard cursor. */
  focusId: string | null;
  /** First book of the top visible row. */
  topId: string | null;
  view: ViewMode;
  /** Opened series (key) or folder; `null` = the top. */
  level: string | null;
  /** Series view in a series: the filter of the overview, in force again on the way back. */
  outerFilter?: string | null;
  look: Look;
}

const VERSION = 3;
const PREFIX = 'cc.view.';

/** Storage of the view states (tests pass their own). */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked site data
  }
}

/** The remembered state, or `null` (none, broken, other version). Fields are checked one by one. */
export function loadViewState(
  categoryId: string,
  store: KeyValueStore | null = defaultStore(),
): ViewState | null {
  try {
    const raw = store?.getItem(PREFIX + categoryId);
    if (!raw) return null;
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (v['v'] !== VERSION && v['v'] !== 2 && v['v'] !== 1) return null;
    const str = (x: unknown) => (typeof x === 'string' ? x : null);
    const view = VIEW_MODES.includes(v['view'] as ViewMode) ? (v['view'] as ViewMode) : 'flat';
    return {
      filter: str(v['filter']) ?? '',
      dimIndex:
        typeof v['dimIndex'] === 'number' && Number.isInteger(v['dimIndex']) && v['dimIndex'] >= 0
          ? v['dimIndex']
          : 0,
      sort: SORT_MODES.includes(v['sort'] as SortMode) ? (v['sort'] as SortMode) : 'path',
      focusId: str(v['focusId']),
      topId: str(v['topId']),
      view,
      level: view === 'flat' ? null : str(v['level']),
      outerFilter: view === 'series' ? str(v['outerFilter']) : null,
      look: LOOKS.includes(v['look'] as Look) ? (v['look'] as Look) : 'grid',
    };
  } catch {
    return null;
  }
}

export function saveViewState(
  categoryId: string,
  state: ViewState,
  store: KeyValueStore | null = defaultStore(),
): void {
  try {
    store?.setItem(PREFIX + categoryId, JSON.stringify({ v: VERSION, ...state }));
  } catch {
    // full or blocked: the view just forgets
  }
}
