import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { KeymapApi } from '../menu/menu-api';
import { actionDef, ActionDef } from './action-catalog';
import { buildKeymap, Keymap } from './keymap';
import { OS } from './platform';
import { formatChord } from './shortcut';

/** What a view offers for an action. */
export interface ActionHandler {
  run(): void;
  /** May read signals (menus follow). Default: enabled. */
  enabled?: () => boolean;
  /** For toggles / radio items in menus. */
  checked?: () => boolean;
}

/**
 * The actions of the app (design 008): views register handlers (removed with their
 * `DestroyRef`; the last registration wins, the one before comes back when it goes), the
 * keyboard dispatcher, menus and the command palette run them by id.
 */
@Injectable({ providedIn: 'root' })
export class ActionService {
  readonly os = inject(OS);
  private readonly keymapApi = inject(KeymapApi);
  private readonly stacks = new Map<string, ActionHandler[]>();
  /** Bumped on every (un)registration – menus and palette recompute. */
  private readonly version = signal(0);
  readonly keymap = signal<Keymap>(buildKeymap(this.os));
  /** Which actions the app allows now (e.g. no grid actions while reading); reads signals. */
  private readonly gate = signal<(def: ActionDef) => boolean>(() => true);

  /** Set once by the app shell (review 008 #5, #6): keys, menus and palette all follow it. */
  setGate(fn: (def: ActionDef) => boolean): void {
    this.gate.set(fn);
  }

  /** Loads `keymap.json` (design 008 E2); problems go to the console only. */
  async loadOverrides(): Promise<void> {
    try {
      const o = await this.keymapApi.loadOverrides();
      const k = buildKeymap(this.os, o.bindings);
      k.notes.forEach((n) => console.warn(n));
      this.keymap.set(k);
    } catch {
      // no backend (browser) or unreadable: the defaults stay
    }
  }

  register(id: string, handler: ActionHandler, destroyRef?: DestroyRef): () => void {
    if (!actionDef(id)) throw new Error(`unknown action ${id}`);
    const stack = this.stacks.get(id) ?? [];
    stack.push(handler);
    this.stacks.set(id, stack);
    this.version.update((v) => v + 1);
    let done = false;
    const off = () => {
      if (done) return;
      done = true;
      const s = this.stacks.get(id);
      const i = s?.lastIndexOf(handler) ?? -1;
      if (s && i >= 0) s.splice(i, 1);
      this.version.update((v) => v + 1);
    };
    destroyRef?.onDestroy(off);
    return off;
  }

  /** Several at once (one `DestroyRef`). */
  registerAll(handlers: Record<string, ActionHandler>, destroyRef?: DestroyRef): void {
    for (const [id, h] of Object.entries(handlers)) this.register(id, h, destroyRef);
  }

  private handler(id: string): ActionHandler | undefined {
    this.version();
    const def = actionDef(id);
    if (!def || !this.gate()(def)) return undefined;
    const s = this.stacks.get(id);
    return s?.[s.length - 1];
  }

  /** A view offers the action now and the gate lets it through. */
  available(id: string): boolean {
    return this.handler(id) !== undefined;
  }

  enabled(id: string): boolean {
    const h = this.handler(id);
    return !!h && (h.enabled?.() ?? true);
  }

  checked(id: string): boolean | undefined {
    return this.handler(id)?.checked?.();
  }

  /** Runs the action if it is there and enabled; `true` = it ran. */
  run(id: string): boolean {
    const h = this.handler(id);
    if (!h || !(h.enabled?.() ?? true)) return false;
    h.run();
    return true;
  }

  def(id: string): ActionDef | undefined {
    return actionDef(id);
  }

  /** The chords of an action (canonical). */
  chords(id: string): string[] {
    return this.keymap().chords.get(id) ?? [];
  }

  /** The first shortcut as the OS shows it, `''` = none. */
  shortcut(id: string): string {
    const c = this.chords(id)[0];
    return c ? formatChord(c, this.os) : '';
  }

  /** Registered actions (for the palette). */
  readonly registered = computed(() => {
    this.version();
    return [...this.stacks.entries()].filter(([, s]) => s.length > 0).map(([id]) => id);
  });
}
