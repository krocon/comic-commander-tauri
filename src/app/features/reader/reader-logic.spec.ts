import {
  anchorOf,
  clampFactor,
  clickZone,
  currentPage,
  DEFAULT_SIZE,
  factorToSlider,
  fitPage,
  guessSizes,
  layoutPages,
  nextZoom,
  PAGE_GAP,
  pageAt,
  pageWidth,
  prefetchPages,
  rotate,
  Rotation,
  scrollTopOf,
  sliderToFactor,
  snapFactor,
  startPage,
  step,
  step2d,
  swipe,
  toRotation,
  visibleRange,
  Zoom,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomAround,
  zoomStep,
} from './reader-logic';

const z = (mode: Zoom['mode'], factor = 1): Zoom => ({ mode, factor });
const sq = (n: number) => Array.from({ length: n }, () => ({ width: 100, height: 100 }));

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

describe('fitPage (design 014)', () => {
  const portrait = { width: 1000, height: 1500 };
  const spread = { width: 2000, height: 1500 };
  const small = { width: 400, height: 600 };

  it('fits width, height, page and full size', () => {
    // view 800 × 600
    expect(fitPage(portrait, 0, z('width'), 800, 600)).toMatchObject({ width: 800, height: 1200 });
    expect(fitPage(portrait, 0, z('height'), 800, 600)).toMatchObject({ width: 400, height: 600 });
    expect(fitPage(portrait, 0, z('page'), 800, 600)).toMatchObject({ width: 400, height: 600 });
    expect(fitPage(portrait, 0, z('full'), 800, 600)).toMatchObject({
      width: 1000,
      height: 1500,
      scale: 1,
    });
    expect(fitPage(portrait, 0, z('custom', 0.5), 800, 600)).toMatchObject({
      width: 500,
      height: 750,
    });
  });

  it('fit height lets a spread be wider than the view (E2), fit page never', () => {
    expect(fitPage(spread, 0, z('height'), 800, 600)).toMatchObject({ width: 800, height: 600 });
    expect(fitPage(spread, 0, z('height'), 600, 600)).toMatchObject({ width: 800, height: 600 });
    expect(fitPage(spread, 0, z('page'), 600, 600)).toMatchObject({ width: 600, height: 450 });
    expect(fitPage(spread, 0, z('width'), 600, 600)).toMatchObject({ width: 600, height: 450 });
  });

  it('enlarges small pages to fit and keeps them for full size', () => {
    expect(fitPage(small, 0, z('page'), 800, 600)).toMatchObject({ width: 400, height: 600 });
    expect(fitPage(small, 0, z('width'), 800, 600)).toMatchObject({ width: 800, height: 1200 });
    expect(fitPage(small, 0, z('full'), 800, 600)).toMatchObject({ width: 400, height: 600 });
  });

  it('swaps the sides when turned by 90° or 270°; the image keeps its own', () => {
    for (const r of [90, 270] as Rotation[]) {
      // turned, the portrait page is 1500 wide and 1000 high
      expect(fitPage(portrait, r, z('width'), 750, 600)).toEqual({
        width: 750,
        height: 500,
        imgWidth: 500,
        imgHeight: 750,
        scale: 0.5,
      });
      expect(fitPage(portrait, r, z('page'), 800, 600)).toMatchObject({ width: 800, height: 533 });
      expect(fitPage(portrait, r, z('full'), 800, 600)).toMatchObject({
        width: 1500,
        height: 1000,
        imgWidth: 1000,
        imgHeight: 1500,
      });
    }
    expect(fitPage(portrait, 180, z('page'), 800, 600)).toMatchObject({ width: 400, height: 600 });
  });

  it('clamps the free factor and survives an empty view or size', () => {
    expect(fitPage(portrait, 0, z('custom', 100), 800, 600).scale).toBe(ZOOM_MAX);
    expect(fitPage(portrait, 0, z('custom', 0.001), 800, 600).scale).toBe(ZOOM_MIN);
    expect(fitPage(portrait, 0, z('custom', NaN), 800, 600).scale).toBe(1);
    expect(fitPage(portrait, 0, z('page'), 0, 0)).toMatchObject({ width: 1, height: 1 });
    expect(fitPage({ width: 0, height: 0 }, 0, z('full'), 800, 600)).toMatchObject(DEFAULT_SIZE);
  });
});

describe('pageWidth: enough pixels, in steps', () => {
  it('follows the image width × dpr', () => {
    const fit = (w: number) => fitPage({ width: w, height: w }, 0, z('custom', 1), 1, 1);
    expect(pageWidth(fit(800), 2, z('page'))).toBe(1600);
    expect(pageWidth(fit(1440), 1, z('width'))).toBe(1600);
    expect(pageWidth(fit(1000), 1, z('height'))).toBe(1024);
    expect(pageWidth(fit(2500), 2, z('custom'))).toBe(0); // beyond 4096: the original
    expect(pageWidth(fit(300), 1, z('full'))).toBe(0); // full size: always the original
  });

  it('a turned page asks by the width of its image, not of its box', () => {
    // turned, the box is 1200 wide, the image only 800
    const f = fitPage({ width: 1000, height: 1500 }, 90, z('width'), 1200, 600);
    expect(f.imgWidth).toBe(800);
    expect(pageWidth(f, 1, z('width'))).toBe(1024);
  });
});

describe('zoom modes, steps, slider and rotation', () => {
  it('cycles the fits, from custom forward to the first', () => {
    expect(nextZoom(z('width'), 1).mode).toBe('height');
    expect(nextZoom(z('full'), 1).mode).toBe('width');
    expect(nextZoom(z('width'), -1).mode).toBe('full');
    expect(nextZoom(z('custom', 2), 1).mode).toBe('width');
    expect(nextZoom(z('custom', 2), -1).mode).toBe('full');
  });

  it('steps like a browser and stays in range', () => {
    expect(zoomStep(1, 1)).toBe(1.1);
    expect(zoomStep(1, -1)).toBe(0.9);
    expect(zoomStep(0.37, 1)).toBe(0.5);
    expect(zoomStep(0.37, -1)).toBe(0.33);
    expect(zoomStep(8, 1)).toBe(ZOOM_MAX);
    expect(zoomStep(0.1, -1)).toBe(ZOOM_MIN);
    expect(clampFactor(-1)).toBe(1);
  });

  it('maps the slider logarithmically and back; snaps near 100 % and a fit', () => {
    expect(sliderToFactor(0)).toBeCloseTo(ZOOM_MIN);
    expect(sliderToFactor(1000)).toBeCloseTo(ZOOM_MAX);
    for (const f of [0.1, 0.37, 1, 2.5, 8]) {
      expect(sliderToFactor(factorToSlider(f))).toBeCloseTo(f, 1);
    }
    expect(factorToSlider(1)).toBe(525);
    expect(snapFactor(1.02, [1, 0.37])).toBe(1);
    expect(snapFactor(0.375, [1, 0.37])).toBe(0.37);
    expect(snapFactor(1.2, [1, 0.37])).toBe(1.2);
  });

  it('rotates in quarter turns', () => {
    expect(rotate(0, 1)).toBe(90);
    expect(rotate(270, 1)).toBe(0);
    expect(rotate(0, -1)).toBe(270);
    let r: Rotation = 0;
    for (let i = 0; i < 4; i++) r = rotate(r, 1);
    expect(r).toBe(0);
    expect(toRotation(180)).toBe(180);
    expect(toRotation(45)).toBe(0);
    expect(toRotation('90')).toBe(0);
  });

  it('zooms around a point that stays put', () => {
    // the point 100 px into the view, scrolled 300: content point 400 → 800 at twice the size
    expect(zoomAround({ left: 300, top: 0 }, { x: 100, y: 50 }, 2)).toEqual({ left: 700, top: 50 });
    expect(zoomAround({ left: 0, top: 0 }, { x: 100, y: 100 }, 0.5)).toEqual({ left: 0, top: 0 });
  });
});

describe('step2d: rows first, then down, then turn (014 Anforderung 4)', () => {
  const view = { width: 1000, height: 1000 };
  const big = { width: 2500, height: 2500 };

  it('without sideways overflow it is the old step', () => {
    expect(step2d(1, { left: 0, top: 0 }, view, { width: 1000, height: 2500 }, false)).toEqual({
      kind: 'scroll',
      left: 0,
      top: 900,
    });
    expect(step2d(1, { left: 0, top: 0 }, view, { width: 1000, height: 800 }, false)).toEqual({
      kind: 'page',
    });
  });

  it('reads a large page left to right, row by row', () => {
    const go = (left: number, top: number) => step2d(1, { left, top }, view, big, false);
    expect(go(0, 0)).toEqual({ kind: 'scroll', left: 900, top: 0 });
    expect(go(900, 0)).toEqual({ kind: 'scroll', left: 1500, top: 0 });
    expect(go(1500, 0)).toEqual({ kind: 'scroll', left: 0, top: 900 });
    expect(go(1500, 1500)).toEqual({ kind: 'page' });
    const back = (left: number, top: number) => step2d(-1, { left, top }, view, big, false);
    expect(back(1500, 900)).toEqual({ kind: 'scroll', left: 600, top: 900 });
    expect(back(0, 900)).toEqual({ kind: 'scroll', left: 1500, top: 0 });
    expect(back(0, 0)).toEqual({ kind: 'page' });
  });

  it('manga reads right to left', () => {
    expect(step2d(1, { left: 1500, top: 0 }, view, big, true)).toEqual({
      kind: 'scroll',
      left: 600,
      top: 0,
    });
    expect(step2d(1, { left: 0, top: 0 }, view, big, true)).toEqual({
      kind: 'scroll',
      left: 1500,
      top: 900,
    });
    expect(step2d(-1, { left: 1500, top: 900 }, view, big, true)).toEqual({
      kind: 'scroll',
      left: 0,
      top: 0,
    });
  });
});

describe('continuous layout', () => {
  it('guesses unknown sizes from known neighbours', () => {
    const a = { width: 100, height: 200 };
    const b = { width: 200, height: 100 };
    expect(guessSizes([null, a, null, b, null])).toEqual([a, a, a, b, b]);
    expect(guessSizes([null, { width: 0, height: 5 }])).toEqual([DEFAULT_SIZE, DEFAULT_SIZE]);
  });

  it('lays out pages by the zoom, wider than the view where it must', () => {
    const sizes = [
      { width: 400, height: 600 },
      { width: 1200, height: 600 },
    ];
    const { boxes, total, maxWidth } = layoutPages(sizes, 800, 600, z('width'), 0);
    expect(boxes.map(({ top, width, height }) => ({ top, width, height }))).toEqual([
      { top: 0, width: 800, height: 1200 },
      { top: 1200 + PAGE_GAP, width: 800, height: 400 },
    ]);
    expect(total).toBe(1600 + PAGE_GAP);
    expect(maxWidth).toBe(800);
    const h = layoutPages(sizes, 800, 600, z('height'), 0);
    expect(h.boxes[0]).toMatchObject({ top: 0, width: 400, height: 600 });
    // fit height: the spread is as high as the view and wider than it (E2)
    expect(h.boxes[1]).toMatchObject({ top: 600 + PAGE_GAP, width: 1200, height: 600 });
    expect(h.maxWidth).toBe(1200);
    const p = layoutPages(sizes, 800, 600, z('page'), 0);
    expect(p.boxes[1]).toMatchObject({ width: 800, height: 400 });
    expect(layoutPages(sizes, 800, 600, z('width'), 90).boxes[0]).toMatchObject({
      width: 800,
      height: 533,
      imgWidth: 533,
      imgHeight: 800,
    });
  });

  it('finds pages, visible ranges and keeps the reading position', () => {
    const { boxes } = layoutPages(sq(5), 100, 100, z('width'), 0);
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
    const { boxes: big } = layoutPages(sq(5), 200, 100, z('width'), 0);
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
