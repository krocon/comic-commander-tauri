import { KeyValueStore } from '../grid/view-state';
import { ReaderFit, ReaderMode } from './reader-logic';

/**
 * Settings of the reader (design 005 E10): mode, fit, manga. In `localStorage` like the grid's
 * view state (004 E9) – a convenience, defaults when it is empty or broken; moves into the
 * settings (Rust) with prompt 009.
 */
export interface ReaderSettings {
  mode: ReaderMode;
  fit: ReaderFit;
  rtl: boolean;
}

export const READER_SETTINGS_KEY = 'cc.reader';
const VERSION = 1;

export const DEFAULT_READER_SETTINGS: ReaderSettings = { mode: 'single', fit: 'width', rtl: false };

export function loadReaderSettings(store: KeyValueStore | null): ReaderSettings {
  try {
    const raw = store?.getItem(READER_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_READER_SETTINGS };
    const v = JSON.parse(raw) as Partial<ReaderSettings> & { v?: number };
    if (v.v !== VERSION) return { ...DEFAULT_READER_SETTINGS };
    return {
      mode: v.mode === 'continuous' ? 'continuous' : 'single',
      fit: v.fit === 'height' ? 'height' : 'width',
      rtl: v.rtl === true,
    };
  } catch {
    return { ...DEFAULT_READER_SETTINGS };
  }
}

export function saveReaderSettings(s: ReaderSettings, store: KeyValueStore | null): void {
  try {
    store?.setItem(READER_SETTINGS_KEY, JSON.stringify({ v: VERSION, ...s }));
  } catch {
    // full or blocked: only a convenience
  }
}
