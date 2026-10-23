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

  it('zooms and turns in the reader without the app’s Mod chords (design 014 E1)', () => {
    for (const os of ['mac', 'other'] as const) {
      const k = buildKeymap(os);
      const r = k.byContext.reader;
      expect(['1', '2', '3', '4'].map((c) => r.get(c))).toEqual([
        'reader.zoom.width',
        'reader.zoom.height',
        'reader.zoom.page',
        'reader.zoom.full',
      ]);
      // digits come first in a keymap object; the menu picks Mod+0 (`menuChord`)
      expect(k.chords.get('reader.zoom.full')).toEqual(['4', 'Mod+0']);
      expect(r.get('w')).toBe('reader.zoom.next');
      expect(r.get('Shift+w')).toBe('reader.zoom.prev');
      expect(r.get('+')).toBe('reader.zoomIn');
      expect(r.get('-')).toBe('reader.zoomOut');
      expect(r.get('r')).toBe('reader.rotateRight');
      expect(r.get('l')).toBe('reader.rotateLeft');
      expect(r.get('z')).toBe('reader.toggleZoomSlider');
      expect(r.get('t')).toBe('reader.toggleToolbar');
      // no reader chord takes a Mod chord of the app (native menu, E1)
      for (const chord of r.keys()) {
        if (chord.includes('Mod+')) expect(k.byContext.global.has(chord)).toBe(false);
      }
      expect(k.chords.has('reader.toggleFit')).toBe(false);
    }
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
