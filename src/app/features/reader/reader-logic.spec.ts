import {
  anchorOf,
  aspects,
  clickZone,
  currentPage,
  DEFAULT_ASPECT,
  KeyLike,
  keyCommand,
  layoutPages,
  PAGE_GAP,
  pageAt,
  prefetchPages,
  scrollTopOf,
  startPage,
  step,
  swipe,
  visibleRange,
  widthBucket,
} from './reader-logic';

function key(k: string, mods: Partial<KeyLike> = {}): KeyLike {
  return { key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods };
}

describe('keyCommand', () => {
  it('turns pages like the old reader', () => {
    for (const k of ['ArrowRight', 'ArrowDown', 'n', 'N', ' ', 'PageDown']) {
      expect(keyCommand(key(k), false)).toBe('next');
    }
    for (const k of ['ArrowLeft', 'ArrowUp', 'b', 'PageUp']) {
      expect(keyCommand(key(k), false)).toBe('prev');
    }
    expect(keyCommand(key(' ', { shiftKey: true }), false)).toBe('prev');
  });

  it('goes to the start / end with Mod or Home / End', () => {
    expect(keyCommand(key('ArrowRight', { metaKey: true }), false)).toBe('last');
    expect(keyCommand(key('ArrowLeft', { ctrlKey: true }), false)).toBe('first');
    expect(keyCommand(key('ArrowDown', { metaKey: true }), false)).toBe('last');
    expect(keyCommand(key('ArrowUp', { ctrlKey: true }), false)).toBe('first');
    expect(keyCommand(key('Home'), false)).toBe('first');
    expect(keyCommand(key('End'), false)).toBe('last');
  });

  it('mirrors only the horizontal keys for manga', () => {
    expect(keyCommand(key('ArrowLeft'), true)).toBe('next');
    expect(keyCommand(key('ArrowRight'), true)).toBe('prev');
    expect(keyCommand(key('ArrowRight', { metaKey: true }), true)).toBe('first');
    expect(keyCommand(key('ArrowDown'), true)).toBe('next');
    expect(keyCommand(key('n'), true)).toBe('next');
    expect(keyCommand(key(' '), true)).toBe('next');
  });

  it('switches, books, full screen, close', () => {
    expect(keyCommand(key('s'), false)).toBe('toggleMode');
    expect(keyCommand(key('W'), false)).toBe('toggleFit');
    expect(keyCommand(key('m'), false)).toBe('toggleRtl');
    expect(keyCommand(key(']'), false)).toBe('nextBook');
    expect(keyCommand(key('['), false)).toBe('prevBook');
    expect(keyCommand(key('F11'), false)).toBe('fullscreen');
    expect(keyCommand(key('f', { metaKey: true, ctrlKey: true }), false)).toBe('fullscreen');
    expect(keyCommand(key('Escape'), false)).toBe('close');
  });

  it('leaves other keys and shortcuts alone', () => {
    expect(keyCommand(key('s', { metaKey: true }), false)).toBeNull();
    expect(keyCommand(key('f', { ctrlKey: true }), false)).toBeNull();
    expect(keyCommand(key('ArrowRight', { altKey: true }), false)).toBeNull();
    expect(keyCommand(key('x'), false)).toBeNull();
    expect(keyCommand(key('Tab'), false)).toBeNull();
  });
});

describe('step: first scroll, then turn', () => {
  it('scrolls a high page one screen at a time', () => {
    // view 1000, page 2500: 900 per step (10 % stays)
    expect(step(1, 0, 1000, 2500)).toEqual({ kind: 'scroll', top: 900 });
    expect(step(1, 900, 1000, 2500)).toEqual({ kind: 'scroll', top: 1500 });
    expect(step(1, 1500, 1000, 2500)).toEqual({ kind: 'page' });
    expect(step(-1, 1500, 1000, 2500)).toEqual({ kind: 'scroll', top: 600 });
    expect(step(-1, 600, 1000, 2500)).toEqual({ kind: 'scroll', top: 0 });
    expect(step(-1, 0, 1000, 2500)).toEqual({ kind: 'page' });
  });

  it('turns at once when the page fits', () => {
    expect(step(1, 0, 1000, 800)).toEqual({ kind: 'page' });
    expect(step(-1, 0, 1000, 800)).toEqual({ kind: 'page' });
    // sub-pixel rest at the end counts as the end
    expect(step(1, 1499.5, 1000, 2500)).toEqual({ kind: 'page' });
  });
});

describe('click zones and swipes', () => {
  it('thirds', () => {
    expect(clickZone(10, 900, false)).toBe('prev');
    expect(clickZone(450, 900, false)).toBeNull();
    expect(clickZone(890, 900, false)).toBe('next');
    expect(clickZone(10, 900, true)).toBe('next');
    expect(clickZone(890, 900, true)).toBe('prev');
    expect(clickZone(10, 0, false)).toBeNull();
  });

  it('swipes horizontally only', () => {
    expect(swipe(-80, 10, false)).toBe('next');
    expect(swipe(80, 10, false)).toBe('prev');
    expect(swipe(-80, 10, true)).toBe('prev');
    expect(swipe(-30, 0, false)).toBeNull();
    expect(swipe(-80, 70, false)).toBeNull();
  });
});

describe('widthBucket', () => {
  it('asks for enough pixels in steps', () => {
    expect(widthBucket(1440, 900, 2)).toBe(3200);
    expect(widthBucket(1440, 900, 1)).toBe(1600);
    expect(widthBucket(800, 1000, 1)).toBe(1024);
    expect(widthBucket(1000, 600, 1)).toBe(1024);
    expect(widthBucket(2560, 1440, 2)).toBe(0); // beyond 4096: the original
    expect(widthBucket(0, 0, 2)).toBe(0);
  });
});

describe('continuous layout', () => {
  it('guesses unknown aspects from known neighbours', () => {
    expect(
      aspects([null, { width: 100, height: 200 }, null, { width: 200, height: 100 }, null]),
    ).toEqual([2, 2, 2, 0.5, 0.5]);
    expect(aspects([null, null])).toEqual([DEFAULT_ASPECT, DEFAULT_ASPECT]);
  });

  it('lays out pages by width or height', () => {
    const { boxes, total } = layoutPages([1.5, 0.5], 800, 600, 'width');
    expect(boxes).toEqual([
      { top: 0, width: 800, height: 1200 },
      { top: 1200 + PAGE_GAP, width: 800, height: 400 },
    ]);
    expect(total).toBe(1600 + PAGE_GAP);
    const h = layoutPages([1.5, 0.5], 800, 600, 'height');
    expect(h.boxes[0]).toEqual({ top: 0, width: 400, height: 600 });
    // a wide page is limited by the view width
    expect(h.boxes[1]).toEqual({ top: 600 + PAGE_GAP, width: 800, height: 400 });
  });

  it('finds pages, visible ranges and keeps the reading position', () => {
    const { boxes } = layoutPages([1, 1, 1, 1, 1], 100, 100, 'width');
    // tops 0, 104, 208, 312, 416
    expect(pageAt(boxes, 0)).toBe(0);
    expect(pageAt(boxes, 103)).toBe(0);
    expect(pageAt(boxes, 104)).toBe(1);
    expect(pageAt(boxes, 10_000)).toBe(4);
    expect(pageAt([], 5)).toBe(-1);
    expect(visibleRange(boxes, 150, 100, 0)).toEqual([1, 2]);
    expect(visibleRange(boxes, 150, 100, 200)).toEqual([0, 4]);
    expect(currentPage(boxes, 200, 100)).toBe(2);
    const a = anchorOf(boxes, 260);
    expect(a).toEqual({ index: 2, fraction: 0.52 });
    // the pages get twice as high: the same place of page 2
    const { boxes: big } = layoutPages([1, 1, 1, 1, 1], 200, 100, 'width');
    expect(scrollTopOf(big, a)).toBe(2 * 204 + 104);
  });
});

describe('start page and prefetch', () => {
  it('continues, except a finished book', () => {
    expect(startPage(null, 10)).toBe(0);
    expect(startPage(4, 10)).toBe(4);
    expect(startPage(9, 10)).toBe(0);
    expect(startPage(12, 10)).toBe(0);
  });

  it('loads the next three and the one before', () => {
    expect(prefetchPages(5, 10)).toEqual([6, 7, 8, 4]);
    expect(prefetchPages(0, 2)).toEqual([1]);
    expect(prefetchPages(9, 10)).toEqual([8]);
  });
});
