import { forwardRef, Injectable } from '@angular/core';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { call } from '../backend/call';
import { ConfigWarning } from '../categories/categories.models';

/** The native menu (macOS, design 008 E8) – mirror of Rust `app_menu::MenuSpec`. */
export type MenuItemSpec =
  | {
      kind: 'action';
      id: string;
      label: string;
      accelerator?: string;
      enabled: boolean;
      checked?: boolean;
    }
  | { kind: 'separator' }
  | { kind: 'submenu'; label: string; items: MenuItemSpec[] };

export interface MenuSpec {
  menus: { label: string; items: MenuItemSpec[] }[];
}

/** Facade of the menu commands; the only place that listens to backend events. */
@Injectable({ providedIn: 'root', useClass: forwardRef(() => TauriMenuApi) })
export abstract class MenuApi {
  abstract setAppMenu(spec: MenuSpec): Promise<void>;
  /** A click in the native menu. */
  abstract onAction(fn: (id: string) => void): Promise<() => void>;
  abstract quit(): Promise<void>;
}

@Injectable({ providedIn: 'root' })
export class TauriMenuApi extends MenuApi {
  setAppMenu(spec: MenuSpec): Promise<void> {
    return call<void>('set_app_menu', { spec });
  }

  async onAction(fn: (id: string) => void): Promise<() => void> {
    if (!isTauri()) return () => undefined;
    return listen<{ id: string }>('menu-action', (e) => fn(e.payload.id));
  }

  quit(): Promise<void> {
    return call<void>('quit_app');
  }
}

export interface KeymapOverrides {
  bindings: Record<string, string[]>;
  warning: ConfigWarning | null;
}

/** Facade of `load_keymap_overrides` (design 008 E2). */
@Injectable({ providedIn: 'root', useClass: forwardRef(() => TauriKeymapApi) })
export abstract class KeymapApi {
  abstract loadOverrides(): Promise<KeymapOverrides>;
}

@Injectable({ providedIn: 'root' })
export class TauriKeymapApi extends KeymapApi {
  loadOverrides(): Promise<KeymapOverrides> {
    return call<KeymapOverrides>('load_keymap_overrides');
  }
}
