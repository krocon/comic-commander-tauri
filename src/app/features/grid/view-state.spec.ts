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
    });
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
});
