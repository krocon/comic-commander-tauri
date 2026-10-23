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
    const all = {
      mode: 'continuous' as const,
      zoom: { mode: 'custom' as const, factor: 1.5 },
      rtl: true,
      zoomSlider: true,
      toolbarPinned: true,
    };
    saveReaderSettings(all, s);
    expect(loadReaderSettings(s)).toEqual(all);
  });

  it('takes over the fit of before design 014', () => {
    const s = memory();
    s.setItem('cc.reader', JSON.stringify({ v: 1, mode: 'single', fit: 'height', rtl: false }));
    expect(loadReaderSettings(s).zoom).toEqual({ mode: 'height', factor: 1 });
    s.setItem('cc.reader', JSON.stringify({ v: 1, fit: 'width' }));
    expect(loadReaderSettings(s).zoom).toEqual({ mode: 'width', factor: 1 });
  });

  it('checks the zoom field by field', () => {
    const s = memory();
    const zoomOf = (zoom: unknown) => {
      s.setItem('cc.reader', JSON.stringify({ v: 1, zoom }));
      return loadReaderSettings(s).zoom;
    };
    expect(zoomOf({ mode: 'page', factor: 3 })).toEqual({ mode: 'page', factor: 3 });
    expect(zoomOf({ mode: 'custom', factor: 99 })).toEqual({ mode: 'custom', factor: 8 });
    expect(zoomOf({ mode: 'custom', factor: 'x' })).toEqual({ mode: 'custom', factor: 1 });
    expect(zoomOf({ mode: 'huge', factor: 2 })).toEqual({ mode: 'width', factor: 1 });
    expect(zoomOf('page')).toEqual({ mode: 'width', factor: 1 });
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
