/**
 * Arithmetic of the shelf look (design 015) – pure, tested without the table.
 *
 * All measures come from the reference photos (`img_2.png`, `img.png`: iBooks, covers 100 × 150)
 * and hold for a cover box 100 px wide; other sizes scale the wood with `s` (E4).
 *
 *   row = 20 headroom + cover + 6 top of the board in front of the book + 16 front edge
 *   x   = 42 margin (30 side wall + 12), covers spread evenly, the first and last flush
 */
import { gridLayout, Size } from './grid-math';
import type { Look } from './view-state';

/** Measures in px at `s = 1` (design 015, table „Aufbau“). */
export const SHELF = {
  upright: 30,
  margin: 42,
  headroom: 20,
  /** visible top of the board in front of the book */
  ledge: 6,
  /** the book stands this deep in the top of the board */
  inset: 6,
  front: 16,
  /** minimal gap between two covers, × cover width (1024 → 6, 768 → 5 columns like the photos) */
  minGap: 0.44,
  /** cover width at `s = 1` */
  base: 100,
  maxScale: 1.6,
} as const;

export interface ShelfLayout {
  cols: number;
  /** width of a table column: the window split evenly, whole px (the table counts
   * `floor(width / cellWidth)` columns) – the book is placed inside, `bookLeft` */
  cellWidth: number;
  /** the box a cover is fitted into (its real aspect, not cropped) */
  coverWidth: number;
  coverHeight: number;
  rowHeight: number;
  gap: number;
  margin: number;
  /** scale of the wood */
  s: number;
  /** height of the board (top + front edge) */
  board: number;
  /** distance of the book's bottom from the bottom of its row */
  bookBottom: number;
}

/** Scale of the wood for a cover box `coverWidth` px wide (E4). */
export function shelfScale(coverWidth: number): number {
  return Math.min(SHELF.maxScale, Math.max(1, coverWidth / SHELF.base));
}

/**
 * Layout of the shelf for `width` px and the chosen cover size: the covers keep their size
 * (unlike the grid, nothing is stretched), as many columns as fit with the minimal gap, the
 * rest spread evenly between them. One column: the book in the middle.
 */
export function shelfLayout(width: number, dim: Size): ShelfLayout {
  const w = Math.max(1, Math.floor(width));
  const cw0 = Math.max(1, dim.width);
  const s0 = shelfScale(cw0);
  const margin0 = Math.round(SHELF.margin * s0);
  // a cover never wider than the space between the side walls
  const coverWidth = Math.max(1, Math.min(cw0, w - 2 * margin0));
  const coverHeight = Math.max(1, Math.round((coverWidth * dim.height) / cw0));
  const s = shelfScale(coverWidth);
  const margin = Math.round(SHELF.margin * s);
  const minGap = SHELF.minGap * coverWidth;
  const inner = w - 2 * margin;
  const cols = Math.max(1, Math.floor((inner + minGap) / (coverWidth + minGap)));
  const gap = cols > 1 ? (inner - cols * coverWidth) / (cols - 1) : 0;
  const ledge = Math.round(SHELF.ledge * s);
  const front = Math.round(SHELF.front * s);
  const headroom = Math.round(SHELF.headroom * s);
  return {
    cols,
    cellWidth: Math.max(1, Math.floor(w / cols)),
    coverWidth,
    coverHeight,
    rowHeight: headroom + coverHeight + ledge + front,
    gap,
    margin,
    s,
    board: Math.round((SHELF.inset + SHELF.ledge + SHELF.front) * s),
    bookBottom: ledge + front,
  };
}

/** Left edge of the book in column `col`, relative to its table cell. */
export function bookLeft(l: ShelfLayout, col: number): number {
  if (l.cols === 1) return Math.round((l.cellWidth - l.coverWidth) / 2);
  const x = l.margin + col * (l.coverWidth + l.gap);
  return Math.round(x - col * l.cellWidth);
}

/**
 * The shelves to draw for the visible part (design 015 E2): index and top of each row in view
 * coordinates, also below the last book down to the bottom of the window (empty shelves).
 * Row `k` starts at `top + k × rowHeight` in the content.
 */
export function visibleShelves(
  scrollTop: number,
  viewHeight: number,
  top: number,
  rowHeight: number,
): { index: number; y: number }[] {
  const h = Math.max(1, rowHeight);
  const first = Math.max(0, Math.floor((scrollTop - top) / h));
  const out: { index: number; y: number }[] = [];
  for (let k = first; ; k++) {
    const y = top + k * h - scrollTop;
    if (y > viewHeight) break;
    out.push({ index: k, y });
    if (out.length > 500) break; // a guard against absurd sizes
  }
  return out;
}

/**
 * Height of the wood in the scrolled content (design 015 E2): the rows, at least the window. Only
 * from the model – the scroll height of the viewport contains the wood and would never shrink.
 */
export function shelfHeight(
  top: number,
  rows: number,
  rowHeight: number,
  viewHeight: number,
): number {
  return Math.max(viewHeight, top + Math.max(0, rows) * rowHeight);
}

/** Size of a cover with natural size `n` fitted into the box (enlarged too – thumbs never are). */
export function fitCover(n: Size, box: Size): Size {
  if (n.width <= 0 || n.height <= 0) return box;
  const f = Math.min(box.width / n.width, box.height / n.height);
  return {
    width: Math.max(1, Math.round(n.width * f)),
    height: Math.max(1, Math.round(n.height * f)),
  };
}

/**
 * What the cover grid lays out for a look (design 015): table columns of `cellWidth`, rows of
 * `rowHeight`, covers in a `coverWidth` × `coverHeight` box. Grid: the cover is the cell; shelf:
 * the cell is a slot on a board, `shelf` has the wood.
 */
export interface Geometry {
  cols: number;
  cellWidth: number;
  rowHeight: number;
  coverWidth: number;
  coverHeight: number;
  shelf: ShelfLayout | null;
}

export function geometry(look: Look, width: number, dim: Size): Geometry {
  if (look === 'shelf') {
    const s = shelfLayout(width, dim);
    return {
      cols: s.cols,
      cellWidth: s.cellWidth,
      rowHeight: s.rowHeight,
      coverWidth: s.coverWidth,
      coverHeight: s.coverHeight,
      shelf: s,
    };
  }
  const g = gridLayout(width, dim);
  return { ...g, cellWidth: g.coverWidth, rowHeight: g.coverHeight, shelf: null };
}
