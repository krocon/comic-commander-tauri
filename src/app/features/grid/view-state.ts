import { SORT_MODES, SortMode } from '../category/book-order';

/**
 * What the grid remembers per category (design 004 E9, E10): filter, size, order and position
 * (book ids, not pixels). In `localStorage` – a per-viewer convenience, nothing is lost when it
 * is empty or broken; moves into the settings (Rust) with prompt 009.
 */
export interface ViewState {
  filter: string;
  dimIndex: number;
  sort: SortMode;
  /** Book with the keyboard cursor. */
  focusId: string | null;
  /** First book of the top visible row. */
  topId: string | null;
}

const VERSION = 1;
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
    if (v['v'] !== VERSION) return null;
    const str = (x: unknown) => (typeof x === 'string' ? x : null);
    return {
      filter: str(v['filter']) ?? '',
      dimIndex:
        typeof v['dimIndex'] === 'number' && Number.isInteger(v['dimIndex']) && v['dimIndex'] >= 0
          ? v['dimIndex']
          : 0,
      sort: SORT_MODES.includes(v['sort'] as SortMode) ? (v['sort'] as SortMode) : 'path',
      focusId: str(v['focusId']),
      topId: str(v['topId']),
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
