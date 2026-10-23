import { DEFAULT_READER_SETTINGS, loadReaderSettings, saveReaderSettings } from './reader-settings';

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  } as Storage;
}

describe('reader settings', () => {
  it('round trip', () => {
    const s = memory();
    saveReaderSettings({ mode: 'continuous', fit: 'height', rtl: true }, s);
    expect(loadReaderSettings(s)).toEqual({ mode: 'continuous', fit: 'height', rtl: true });
  });

  it('defaults for nothing, broken or foreign data', () => {
    expect(loadReaderSettings(null)).toEqual(DEFAULT_READER_SETTINGS);
    const s = memory();
    s.setItem('cc.reader', '{broken');
    expect(loadReaderSettings(s)).toEqual(DEFAULT_READER_SETTINGS);
    s.setItem('cc.reader', JSON.stringify({ v: 1, mode: 'x', fit: 7, rtl: 'yes' }));
    expect(loadReaderSettings(s)).toEqual(DEFAULT_READER_SETTINGS);
    s.setItem('cc.reader', JSON.stringify({ v: 99, mode: 'continuous' }));
    expect(loadReaderSettings(s)).toEqual(DEFAULT_READER_SETTINGS);
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(loadReaderSettings(throwing)).toEqual(DEFAULT_READER_SETTINGS);
    expect(() => saveReaderSettings(DEFAULT_READER_SETTINGS, throwing)).not.toThrow();
  });
});
