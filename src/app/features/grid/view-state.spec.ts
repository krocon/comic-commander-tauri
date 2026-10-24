import { KeyValueStore, loadViewState, saveViewState, ViewState } from './view-state';

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const state: ViewState = {
  filter: '+asterix',
  dimIndex: 1,
  sort: 'date',
  focusId: 'a',
  topId: 'b',
  view: 'series',
  level: 'asterix',
  outerFilter: 'ang',
  look: 'shelf',
};

describe('view-state (E9)', () => {
  it('round-trips per category', () => {
    const s = memory();
    saveViewState('c1', state, s);
    expect(loadViewState('c1', s)).toEqual(state);
    expect(loadViewState('c2', s)).toBeNull();
  });

  it('survives broken, foreign and throwing storage', () => {
    const s = memory();
    s.data.set('cc.view.c1', '{broken');
    expect(loadViewState('c1', s)).toBeNull();
    s.data.set('cc.view.c1', JSON.stringify({ v: 99, filter: 'x' }));
    expect(loadViewState('c1', s)).toBeNull();
    s.data.set('cc.view.c1', JSON.stringify({ v: 1, filter: 3, dimIndex: -2, sort: 'evil' }));
    expect(loadViewState('c1', s)).toEqual({
      filter: '',
      dimIndex: 0,
      sort: 'path',
      focusId: null,
      topId: null,
      view: 'flat',
      level: null,
      outerFilter: null,
      look: 'grid',
    });
    s.data.set('cc.view.c1', JSON.stringify({ v: 2, view: 'evil', level: 'x' }));
    expect(loadViewState('c1', s)?.view).toBe('flat');
    expect(loadViewState('c1', s)?.level).toBeNull();
    s.data.set('cc.view.c1', JSON.stringify({ v: 3, look: 'evil' }));
    expect(loadViewState('c1', s)?.look).toBe('grid');
    const throwing: KeyValueStore = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
    };
    expect(loadViewState('c1', throwing)).toBeNull();
    expect(() => saveViewState('c1', state, throwing)).not.toThrow();
    expect(loadViewState('c1', null)).toBeNull();
  });

  it('reads a v1 state with the flat view (design 011)', () => {
    const s = memory();
    s.data.set(
      'cc.view.c1',
      JSON.stringify({ v: 1, filter: 'x', dimIndex: 1, sort: 'name', focusId: 'f', topId: 't' }),
    );
    expect(loadViewState('c1', s)).toEqual({
      filter: 'x',
      dimIndex: 1,
      sort: 'name',
      focusId: 'f',
      topId: 't',
      view: 'flat',
      level: null,
      outerFilter: null,
      look: 'grid',
    });
  });

  it('reads a v2 state with the grid look (design 015)', () => {
    const s = memory();
    s.data.set('cc.view.c1', JSON.stringify({ ...state, v: 2, look: undefined }));
    expect(loadViewState('c1', s)).toEqual({ ...state, look: 'grid' });
  });
});
