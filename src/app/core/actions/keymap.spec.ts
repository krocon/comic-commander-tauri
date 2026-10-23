import { ACTIONS } from './action-catalog';
import { buildKeymap } from './keymap';

describe('keymap', () => {
  it('has only known actions and valid chords', () => {
    for (const os of ['mac', 'other'] as const) {
      expect(buildKeymap(os).notes).toEqual([]);
    }
  });

  it('differs per OS where it must', () => {
    expect(buildKeymap('mac').byContext.reader.get('Mod+Ctrl+f')).toBe('reader.fullscreen');
    expect(buildKeymap('other').byContext.reader.get('F11')).toBe('reader.fullscreen');
    expect(buildKeymap('other').byContext.global.get('F10')).toBe('app.focusMenu');
    expect(buildKeymap('mac').byContext.global.get('F10')).toBeUndefined();
  });

  it('lists the chords of an action', () => {
    const k = buildKeymap('other');
    expect(k.chords.get('reader.next')).toEqual(['ArrowDown', 'n', 'Shift+n', 'Space', 'PageDown']);
    expect(k.chords.get('view.sizeUp')).toEqual(['Mod++', 'Mod+=']);
  });

  it('applies the user overrides', () => {
    const k = buildKeymap('other', {
      'reader.next': ['j', 'Ctrl+Shift+N'],
      'app.palette': [],
      'reader.prev': ['n'],
      nope: ['x'],
      'grid.read': ['Hyper+x'],
    });
    expect(k.byContext.reader.get('j')).toBe('reader.next');
    expect(k.byContext.reader.get('Mod+Shift+n')).toBe('reader.next');
    expect(k.byContext.reader.get('Space')).toBeUndefined();
    // taken over by another action of the same context
    expect(k.byContext.reader.get('n')).toBe('reader.prev');
    expect(k.chords.get('app.palette')).toBeUndefined();
    expect(k.notes.length).toBe(2);
  });

  it('every catalog id is unique', () => {
    expect(new Set(ACTIONS.map((a) => a.id)).size).toBe(ACTIONS.length);
  });
});
