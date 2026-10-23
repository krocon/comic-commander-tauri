import base from './keymap.base.json';
import mac from './keymap.mac.json';
import other from './keymap.other.json';
import { actionDef, ActionContext } from './action-catalog';
import { Os } from './platform';
import { normalizeChord } from './shortcut';

type KeymapFile = Record<ActionContext, Record<string, string>>;

/** The shortcuts in force: context → chord → action, and action → chords (design 008 E7). */
export interface Keymap {
  byContext: Record<ActionContext, Map<string, string>>;
  chords: Map<string, string[]>;
  /** Notes for the console: unknown actions, bad chords in the user's file. */
  notes: string[];
}

/**
 * Base + OS keymap, then the user's overrides (`keymap.json`): an action named there gets
 * exactly those chords (`[]` = none) in its own context; a chord taken by another action of the
 * same context moves to the overriding one.
 */
export function buildKeymap(os: Os, overrides: Record<string, string[]> = {}): Keymap {
  const notes: string[] = [];
  const byContext: Keymap['byContext'] = { global: new Map(), grid: new Map(), reader: new Map() };
  for (const file of [base as KeymapFile, (os === 'mac' ? mac : other) as KeymapFile]) {
    for (const ctx of Object.keys(byContext) as ActionContext[]) {
      for (const [chord, id] of Object.entries(file[ctx] ?? {})) {
        const c = normalizeChord(chord, os);
        if (c && actionDef(id)) byContext[ctx].set(c, id);
        else notes.push(`keymap: ${chord} → ${id} ignored`);
      }
    }
  }
  for (const [id, chords] of Object.entries(overrides)) {
    const def = actionDef(id);
    if (!def) {
      notes.push(`keymap.json: unknown action ${id}`);
      continue;
    }
    const map = byContext[def.context];
    for (const [c, a] of [...map]) if (a === id) map.delete(c);
    for (const chord of chords) {
      const c = normalizeChord(chord, os);
      if (c) map.set(c, id);
      else notes.push(`keymap.json: bad shortcut ${chord} for ${id}`);
    }
  }
  const chords = new Map<string, string[]>();
  for (const map of Object.values(byContext)) {
    for (const [c, id] of map) chords.set(id, [...(chords.get(id) ?? []), c]);
  }
  return { byContext, chords, notes };
}
