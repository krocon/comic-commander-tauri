import { chordOf, formatChord, normalizeChord } from './shortcut';

const ev = (
  key: string,
  m: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {},
) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...m,
});

describe('shortcut notation', () => {
  it('turns key events into chords per OS', () => {
    expect(chordOf(ev('p', { metaKey: true, shiftKey: true }), 'mac')).toBe('Mod+Shift+p');
    expect(chordOf(ev('P', { ctrlKey: true, shiftKey: true }), 'other')).toBe('Mod+Shift+p');
    expect(chordOf(ev('f', { metaKey: true, ctrlKey: true }), 'mac')).toBe('Mod+Ctrl+f');
    expect(chordOf(ev(' '), 'other')).toBe('Space');
    expect(chordOf(ev(' ', { shiftKey: true }), 'other')).toBe('Shift+Space');
    expect(chordOf(ev('ArrowRight', { metaKey: true }), 'mac')).toBe('Mod+ArrowRight');
    // punctuation: Shift is in the character already
    expect(chordOf(ev('+', { ctrlKey: true, shiftKey: true }), 'other')).toBe('Mod++');
    expect(chordOf(ev(']'), 'mac')).toBe(']');
    expect(chordOf(ev('Shift', { shiftKey: true }), 'mac')).toBeNull();
    expect(chordOf(ev('Meta', { metaKey: true }), 'mac')).toBeNull();
    expect(chordOf(ev('F10', { shiftKey: true }), 'other')).toBe('Shift+F10');
    // German layouts: [ ] come with Alt (macOS) or AltGr = Ctrl+Alt (Windows) – review 008 #10
    expect(chordOf(ev(']', { altKey: true }), 'mac')).toBe(']');
    expect(chordOf(ev('[', { altKey: true, ctrlKey: true }), 'other')).toBe('[');
    expect(chordOf(ev('[', { altKey: true, metaKey: true }), 'mac')).toBe('Mod+[');
    expect(chordOf(ev('x', { altKey: true }), 'mac')).toBe('Alt+x');
  });

  it('normalizes written chords', () => {
    expect(normalizeChord('Mod+Shift+P', 'mac')).toBe('Mod+Shift+p');
    expect(normalizeChord('Ctrl+Shift+P', 'other')).toBe('Mod+Shift+p');
    expect(normalizeChord('Ctrl+Shift+P', 'mac')).toBe('Ctrl+Shift+p');
    expect(normalizeChord('Cmd+,', 'mac')).toBe('Mod+,');
    expect(normalizeChord('Mod++', 'other')).toBe('Mod++');
    expect(normalizeChord('Shift+?', 'other')).toBe('?');
    expect(normalizeChord('Space', 'other')).toBe('Space');
    expect(normalizeChord('Hyper+x', 'other')).toBeNull();
    expect(normalizeChord('Mod+', 'other')).toBeNull();
    expect(normalizeChord('', 'other')).toBeNull();
  });

  it('shows chords the way the OS does', () => {
    expect(formatChord('Mod+Shift+p', 'mac')).toBe('⌘⇧P');
    expect(formatChord('Mod+Shift+p', 'other')).toBe('Ctrl+Shift+P');
    expect(formatChord('Mod++', 'other')).toBe('Ctrl++');
    expect(formatChord('ArrowRight', 'mac')).toBe('→');
    expect(formatChord('Mod+Ctrl+f', 'mac')).toBe('⌘⌃F');
    expect(formatChord('Space', 'other')).toBe('Space');
    expect(formatChord('Escape', 'other')).toBe('Esc');
  });
});
