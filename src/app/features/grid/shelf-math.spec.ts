import {
  bookLeft,
  fitCover,
  geometry,
  shelfHeight,
  shelfLayout,
  shelfScale,
  visibleShelves,
} from './shelf-math';

const C100 = { width: 100, height: 150 };

describe('shelfLayout (design 015, measured on the reference photos)', () => {
  it('img.png: 1024 px → 6 books, 68 px apart, 42 px margin', () => {
    const l = shelfLayout(1024, C100);
    expect(l.cols).toBe(6);
    expect(l.gap).toBe(68);
    expect(l.margin).toBe(42);
    expect(l.rowHeight).toBe(192);
    // the books sit at 42, 210, 378, … like the photo
    const xs = [0, 1, 2, 3, 4, 5].map((c) => c * l.cellWidth + bookLeft(l, c));
    expect(xs).toEqual([42, 210, 378, 546, 714, 882]);
  });

  it('img_2.png: 768 px → 5 books, 46 px apart', () => {
    const l = shelfLayout(768, C100);
    expect(l.cols).toBe(5);
    expect(l.gap).toBe(46);
    expect([0, 1, 2, 3, 4].map((c) => c * l.cellWidth + bookLeft(l, c))).toEqual([
      42, 188, 334, 480, 626,
    ]);
  });

  it('keeps every book inside its cell (clicks hit the right book)', () => {
    for (const w of [300, 500, 768, 1024, 1333, 1920, 2560]) {
      for (const dim of [C100, { width: 200, height: 300 }, { width: 140, height: 220 }]) {
        const l = shelfLayout(w, dim);
        expect(l.cols * l.cellWidth).toBeLessThanOrEqual(w);
        for (let c = 0; c < l.cols; c++) {
          const x = bookLeft(l, c);
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x + l.coverWidth).toBeLessThanOrEqual(l.cellWidth);
        }
      }
    }
  });

  it('a narrow window: one book in the middle, never wider than the shelf', () => {
    const l = shelfLayout(250, C100);
    expect(l.cols).toBe(1);
    expect(bookLeft(l, 0)).toBe(75);
    const narrow = shelfLayout(150, C100);
    expect(narrow.coverWidth).toBe(150 - 2 * 42);
    expect(bookLeft(narrow, 0)).toBe(42);
    const tiny = shelfLayout(60, C100);
    expect(tiny.coverWidth).toBeGreaterThanOrEqual(1);
    expect(tiny.coverHeight).toBe(Math.round(tiny.coverWidth * 1.5));
    expect(shelfLayout(0, C100).cols).toBe(1);
  });

  it('scales the wood with bigger covers, up to 1.6 (E4)', () => {
    expect(shelfScale(80)).toBe(1);
    expect(shelfScale(130)).toBe(1.3);
    expect(shelfScale(800)).toBe(1.6);
    const l = shelfLayout(1920, { width: 200, height: 300 });
    expect(l.s).toBe(1.6);
    expect(l.rowHeight).toBe(32 + 300 + 10 + 26);
    expect(l.bookBottom).toBe(10 + 26);
  });
});

describe('geometry', () => {
  it('grid: the cover is the cell', () => {
    expect(geometry('grid', 1000, { width: 200, height: 300 })).toEqual({
      cols: 5,
      cellWidth: 200,
      rowHeight: 300,
      coverWidth: 200,
      coverHeight: 300,
      shelf: null,
    });
  });

  it('shelf: rows are higher than the covers', () => {
    const g = geometry('shelf', 768, C100);
    expect(g.rowHeight).toBe(192);
    expect(g.coverHeight).toBe(150);
    expect(g.cellWidth).toBe(153);
    expect(g.shelf?.cols).toBe(5);
  });
});

describe('visibleShelves (E2)', () => {
  it('fills the window, also below the last book', () => {
    expect(visibleShelves(0, 500, 56, 192)).toEqual([
      { index: 0, y: 56 },
      { index: 1, y: 248 },
      { index: 2, y: 440 },
    ]);
  });

  it('follows the scroll position', () => {
    const rows = visibleShelves(1000, 400, 56, 192);
    expect(rows[0]).toEqual({ index: 4, y: 56 + 4 * 192 - 1000 });
    expect(rows.at(-1)!.y).toBeLessThanOrEqual(400);
    expect(rows.map((r) => r.index)).toEqual([4, 5, 6, 7]);
  });
});

describe('fitCover', () => {
  it('fits the real aspect into the box, also enlarging', () => {
    expect(fitCover({ width: 200, height: 300 }, C100)).toEqual(C100);
    expect(fitCover({ width: 300, height: 300 }, C100)).toEqual({ width: 100, height: 100 });
    expect(fitCover({ width: 40, height: 100 }, C100)).toEqual({ width: 60, height: 150 });
    expect(fitCover({ width: 0, height: 0 }, C100)).toEqual(C100);
  });
});

describe('shelfHeight (E2)', () => {
  it('follows the rows and shrinks again – a filter must not leave the view scrolled into nothing', () => {
    expect(shelfHeight(56, 8334, 192, 700)).toBe(56 + 8334 * 192);
    expect(shelfHeight(56, 2, 192, 700)).toBe(700);
    expect(shelfHeight(56, 0, 192, 700)).toBe(700);
  });
});
