import { KeyValueStore } from '../grid/view-state';
import { clampFactor, DEFAULT_ZOOM, ReaderMode, Zoom, ZoomMode } from './reader-logic';

/**
 * Settings of the reader (design 005 E10, 014 E5): mode, zoom, manga, zoom slider, toolbar. In
 * `localStorage` like the grid's view state (004 E9) – a convenience, defaults when it is empty
 * or broken; moves into the settings (Rust) with prompt 009. The rotation is per book (reading
 * state), not here.
 */
export interface ReaderSettings {
  mode: ReaderMode;
  zoom: Zoom;
  rtl: boolean;
  /** „Show zoom slider“ (014 Anforderung 10). */
  zoomSlider: boolean;
  /** „Always show toolbar“ (014 Anforderung 20). */
  toolbarPinned: boolean;
}

export const READER_SETTINGS_KEY = 'cc.reader';
const VERSION = 1;
const MODES: readonly ZoomMode[] = ['width', 'height', 'page', 'full', 'custom'];

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  mode: 'single',
  zoom: { ...DEFAULT_ZOOM },
  rtl: false,
  zoomSlider: false,
  toolbarPinned: false,
};

/** The zoom of stored settings; before 014 there was only `fit: 'width' | 'height'`. */
function readZoom(v: { zoom?: unknown; fit?: unknown }): Zoom {
  const z = v.zoom as Partial<Zoom> | undefined;
  if (z && typeof z === 'object' && MODES.includes(z.mode as ZoomMode)) {
    return { mode: z.mode as ZoomMode, factor: clampFactor(Number(z.factor)) };
  }
  return { mode: v.fit === 'height' ? 'height' : 'width', factor: 1 };
}

export function loadReaderSettings(store: KeyValueStore | null): ReaderSettings {
  try {
    const raw = store?.getItem(READER_SETTINGS_KEY);
    if (!raw) return structuredClone(DEFAULT_READER_SETTINGS);
    const v = JSON.parse(raw) as Partial<ReaderSettings> & { v?: number; fit?: unknown };
    if (v.v !== VERSION) return structuredClone(DEFAULT_READER_SETTINGS);
    return {
      mode: v.mode === 'continuous' ? 'continuous' : 'single',
      zoom: readZoom(v),
      rtl: v.rtl === true,
      zoomSlider: v.zoomSlider === true,
      toolbarPinned: v.toolbarPinned === true,
    };
  } catch {
    return structuredClone(DEFAULT_READER_SETTINGS);
  }
}

export function saveReaderSettings(s: ReaderSettings, store: KeyValueStore | null): void {
  try {
    store?.setItem(READER_SETTINGS_KEY, JSON.stringify({ v: VERSION, ...s }));
  } catch {
    // full or blocked: only a convenience
  }
}
