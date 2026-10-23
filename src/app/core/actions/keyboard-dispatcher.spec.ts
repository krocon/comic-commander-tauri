import { DestroyRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActionService } from './action.service';
import { KeyboardDispatcher } from './keyboard-dispatcher';
import { OS } from './platform';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((f) => f()));

function setup() {
  TestBed.configureTestingModule({ providers: [{ provide: OS, useValue: 'other' }] });
  const actions = TestBed.inject(ActionService);
  const dispatcher = TestBed.inject(KeyboardDispatcher);
  const ran: string[] = [];
  // one listener per test (attach() would stay on the document across tests)
  const listener = (e: KeyboardEvent) => dispatcher.handle(e);
  document.addEventListener('keydown', listener);
  cleanups.push(() => document.removeEventListener('keydown', listener));
  const reg = (id: string, enabled = () => true) =>
    actions.register(id, { run: () => ran.push(id), enabled });
  return { actions, dispatcher, ran, reg };
}

function key(target: Element, k: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

describe('KeyboardDispatcher', () => {
  let host: HTMLDivElement;
  beforeEach(() => {
    host = document.createElement('div');
    host.innerHTML = `<button id="b">b</button><input id="t" type="search"><input id="r" type="range">
      <ul role="menu"><li id="m" tabindex="-1">x</li></ul><div id="g" tabindex="0"></div>`;
    document.body.appendChild(host);
  });
  afterEach(() => host.remove());
  const el = (id: string) => host.querySelector('#' + id)!;

  it('runs the action of the first context that has the chord', () => {
    const { dispatcher, ran, reg } = setup();
    dispatcher.setContextProvider(() => ['reader', 'global']);
    reg('reader.close');
    reg('app.rescan');
    reg('grid.escape');
    expect(key(el('g'), 'Escape').defaultPrevented).toBe(true);
    key(el('g'), 'r', { ctrlKey: true });
    expect(ran).toEqual(['reader.close', 'app.rescan']);
  });

  it('leaves text fields their keys except Mod shortcuts; buttons, sliders and menus theirs', () => {
    const { dispatcher, ran, reg } = setup();
    dispatcher.setContextProvider(() => ['grid', 'global']);
    reg('grid.escape');
    reg('grid.read');
    reg('grid.left');
    reg('view.focusFilter');
    reg('grid.menu');
    key(el('t'), 'Escape');
    key(el('t'), 'ArrowLeft');
    key(el('t'), 'f', { ctrlKey: true });
    key(el('b'), 'Enter');
    key(el('b'), ' ');
    key(el('r'), 'ArrowLeft');
    key(el('m'), 'Enter');
    expect(ran).toEqual(['view.focusFilter']);
  });

  it('nothing while a dialog owns the keyboard; unregistered and disabled actions do not take the key', () => {
    const { dispatcher, ran, reg } = setup();
    dispatcher.setContextProvider(() => null);
    reg('reader.close');
    expect(key(el('g'), 'Escape').defaultPrevented).toBe(false);
    dispatcher.setContextProvider(() => ['grid']);
    expect(key(el('g'), 'Enter').defaultPrevented).toBe(false);
    reg('grid.read', () => false);
    // registered but disabled: the key is taken, nothing runs
    key(el('g'), 'Enter');
    expect(ran).toEqual([]);
  });

  it('F-keys reach the app from a text field (F10 → menu bar, review 008 #8)', () => {
    const { dispatcher, ran, reg } = setup();
    dispatcher.setContextProvider(() => ['global']);
    reg('app.focusMenu');
    key(el('t'), 'F10');
    expect(ran).toEqual(['app.focusMenu']);
  });

  it('a gated action is not there: the key goes on to the next context (review 008 #5)', () => {
    const { actions, dispatcher, ran, reg } = setup();
    dispatcher.setContextProvider(() => ['reader', 'global']);
    reg('app.rescan');
    reg('app.about');
    actions.setGate((def) => def.id !== 'app.rescan');
    expect(key(el('g'), 'r', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(actions.available('app.rescan')).toBe(false);
    expect(actions.enabled('app.rescan')).toBe(false);
    expect(actions.run('app.rescan')).toBe(false);
    expect(actions.run('app.about')).toBe(true);
    expect(ran).toEqual(['app.about']);
  });

  it('a fallback is removed only by its owner (review 008 #12)', () => {
    const { dispatcher } = setup();
    dispatcher.setContextProvider(() => ['grid']);
    const typed: string[] = [];
    const old = () => false;
    const now = (e: KeyboardEvent) => typed.push(e.key) > 0;
    dispatcher.setFallback('grid', old);
    dispatcher.setFallback('grid', now);
    dispatcher.clearFallback('grid', old);
    key(el('g'), 'x');
    dispatcher.clearFallback('grid', now);
    key(el('g'), 'y');
    expect(typed).toEqual(['x']);
  });

  it('keeps the webview menu (Back, Reload, Inspect) away except in text fields', () => {
    const { dispatcher } = setup();
    const menu = (target: Element) => {
      const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      target.dispatchEvent(e);
      dispatcher.contextMenu(e);
      return e.defaultPrevented;
    };
    expect(menu(el('g'))).toBe(true);
    expect(menu(el('m'))).toBe(true);
    expect(menu(el('t'))).toBe(false);
  });

  it('a held key repeats only repeatable actions; typing falls back', () => {
    const { dispatcher, ran, reg } = setup();
    dispatcher.setContextProvider(() => ['grid', 'global']);
    reg('grid.right');
    reg('grid.read');
    key(el('g'), 'ArrowRight', { repeat: true });
    key(el('g'), 'Enter', { repeat: true });
    const typed: string[] = [];
    dispatcher.setFallback('grid', (e) => {
      typed.push(e.key);
      return true;
    });
    expect(key(el('g'), 'x').defaultPrevented).toBe(true);
    expect(ran).toEqual(['grid.right']);
    expect(typed).toEqual(['x']);
  });
});

describe('ActionService', () => {
  it('stacks registrations, follows DestroyRef, knows shortcuts', () => {
    const { actions } = setup();
    const ran: string[] = [];
    const offA = actions.register('app.about', { run: () => ran.push('a') });
    let destroy: () => void = () => undefined;
    const ref = { onDestroy: (fn: () => void) => (destroy = fn) } as unknown as DestroyRef;
    actions.register('app.about', { run: () => ran.push('b') }, ref);
    actions.run('app.about');
    destroy();
    actions.run('app.about');
    offA();
    expect(actions.run('app.about')).toBe(false);
    expect(ran).toEqual(['b', 'a']);
    expect(actions.shortcut('app.palette')).toBe('Ctrl+Shift+P');
    expect(actions.shortcut('app.about')).toBe('');
    expect(() => actions.register('nope', { run: () => undefined })).toThrow();
  });
});
