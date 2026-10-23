import { Os } from './platform';

/**
 * Shortcut notation (design 008 E6): `Mod+Ctrl+Alt+Shift+Meta+Key`, `Mod` = ⌘ on macOS, Ctrl
 * elsewhere. The key is `KeyboardEvent.key`: letters lower case, `Space`, `ArrowRight`, `F11`,
 * `Escape` …; for punctuation `Shift` does not count (the key already is the shifted character,
 * `Mod++` = Ctrl+Shift+= on a US keyboard). Same rules as Rust `app_menu::split_chord`.
 */
const ORDER = ['Mod', 'Ctrl', 'Alt', 'Shift', 'Meta'] as const;
type Modifier = (typeof ORDER)[number];

const IGNORED = new Set([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'OS',
  'CapsLock',
  'Dead',
  'Unidentified',
  'AltGraph',
  '',
]);

export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

function keyName(key: string): string {
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toLowerCase();
  if (key === 'Esc') return 'Escape';
  if (key === 'Apps') return 'ContextMenu';
  return key;
}

/** Shift counts for letters and named keys, not for punctuation and digits. */
function shiftCounts(key: string): boolean {
  return key.length > 1 || /^[a-z]$/.test(key);
}

function join(mods: Set<Modifier>, key: string): string {
  if (!shiftCounts(key)) mods.delete('Shift');
  return [...ORDER.filter((m) => mods.has(m)), key].join('+');
}

/** The chord of a key event, `null` for a lone modifier. */
export function chordOf(e: KeyEventLike, os: Os): string | null {
  if (IGNORED.has(e.key)) return null;
  const mods = new Set<Modifier>();
  // on many layouts punctuation needs Alt (macOS) or AltGr = Ctrl+Alt (Windows): `[` is `[`
  const punct = e.key.length === 1 && !/[\p{L}\p{N} ]/u.test(e.key);
  const altGr = punct && os === 'other' && e.ctrlKey && e.altKey;
  if (os === 'mac') {
    if (e.metaKey) mods.add('Mod');
    if (e.ctrlKey) mods.add('Ctrl');
  } else {
    if (e.ctrlKey && !altGr) mods.add('Mod');
    if (e.metaKey) mods.add('Meta');
  }
  if (e.altKey && !punct) mods.add('Alt');
  if (e.shiftKey) mods.add('Shift');
  return join(mods, keyName(e.key));
}

/** Parses a written chord into the canonical form (`null` = not a chord). */
export function normalizeChord(chord: string, os: Os): string | null {
  if (!chord || chord.length > 40) return null;
  let head: string;
  let key: string;
  if (chord === '+') {
    head = '';
    key = '+';
  } else if (chord.endsWith('++')) {
    head = chord.slice(0, -2);
    key = '+';
  } else {
    const i = chord.lastIndexOf('+');
    head = i < 0 ? '' : chord.slice(0, i);
    key = i < 0 ? chord : chord.slice(i + 1);
  }
  if (!key) return null;
  const mods = new Set<Modifier>();
  for (const raw of head ? head.split('+') : []) {
    const m = raw === 'Cmd' || raw === 'Command' ? 'Mod' : raw === 'Control' ? 'Ctrl' : raw;
    if (!(ORDER as readonly string[]).includes(m)) return null;
    // Ctrl is Mod outside macOS
    mods.add(os === 'other' && m === 'Ctrl' ? 'Mod' : (m as Modifier));
  }
  return join(mods, keyName(key));
}

const MAC_SYMBOLS: Record<string, string> = {
  Mod: '⌘',
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Meta: '◆',
};
const KEY_LABELS: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  ContextMenu: 'Menu',
};

/** How a chord is shown: `⌘⇧P` on macOS, `Ctrl+Shift+P` elsewhere. */
export function formatChord(chord: string, os: Os): string {
  let head: string[];
  let raw: string;
  if (chord.endsWith('++')) {
    head = chord.slice(0, -2).split('+').filter(Boolean);
    raw = '+';
  } else {
    const i = chord.lastIndexOf('+');
    head = i <= 0 ? [] : chord.slice(0, i).split('+');
    raw = i <= 0 ? chord : chord.slice(i + 1);
  }
  const key = KEY_LABELS[raw] ?? (raw.length === 1 ? raw.toUpperCase() : raw);
  if (os === 'mac') return head.map((m) => MAC_SYMBOLS[m] ?? m).join('') + key;
  const names: Record<string, string> = { Mod: 'Ctrl', Meta: 'Win' };
  return [...head.map((m) => names[m] ?? m), key].join('+');
}
