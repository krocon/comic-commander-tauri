import { ShelfLayout, visibleShelves } from './shelf-math';

/**
 * The wood behind the cover grid in the shelf look (design 015 E2): back wall, side walls and one
 * board per row – drawn once under the books, not per cell, so there are no seams and empty
 * boards go on below the last book down to the bottom of the window.
 *
 * Plain DOM like the renderer. It lives in the table's scroll viewport (first child, under the
 * content) and is as tall as the scrolled content: the browser scrolls it natively, nothing is
 * moved or repainted per scroll step. Only the boards near the visible part exist (a pool); a
 * board is moved when its row leaves the view. Measured end to end (Xvfb, software rendering):
 * a layer that was laid out again on every scroll event dropped frames on fast wheel scrolling.
 */
export class ShelfBackdrop {
  readonly element: HTMLDivElement;
  private readonly rows: HTMLDivElement[] = [];
  private key = '';

  constructor(doc: Document) {
    const el = doc.createElement('div');
    el.className = 'cc-shelf-bg';
    el.setAttribute('aria-hidden', 'true');
    for (const cls of ['cc-shelf-wall', 'cc-shelf-upright', 'cc-shelf-upright cc-right']) {
      const d = doc.createElement('div');
      d.className = cls;
      el.appendChild(d);
    }
    this.element = el;
  }

  /**
   * Lays the wood out: `top` = padding above the first row (toolbar); the element covers
   * `width` × `height` of the scrolled content, boards for the part from `scrollTop` that is
   * `viewHeight` high (one extra row above and below).
   */
  update(
    l: ShelfLayout,
    top: number,
    scrollTop: number,
    viewHeight: number,
    width: number,
    height: number,
  ): void {
    const el = this.element;
    const size = `${l.s}|${l.rowHeight}|${width}|${height}|${top}`;
    if (size !== this.key) {
      this.key = size;
      el.style.setProperty('--shelf-s', String(l.s));
      el.style.setProperty('--shelf-row', `${l.rowHeight}px`);
      el.style.width = `${Math.max(0, width)}px`;
      el.style.height = `${Math.max(0, height, viewHeight)}px`;
      for (const r of this.rows) r.dataset['k'] = '';
    }
    const from = Math.max(0, scrollTop - l.rowHeight);
    const shelves = visibleShelves(from, viewHeight + 2 * l.rowHeight, top, l.rowHeight).map(
      (s) => s.index,
    );
    const doc = el.ownerDocument;
    while (this.rows.length < shelves.length) {
      const row = doc.createElement('div');
      row.className = 'cc-shelf-row';
      const shadow = doc.createElement('div');
      shadow.className = 'cc-shelf-shadow';
      const board = doc.createElement('div');
      board.className = 'cc-shelf-board';
      row.append(shadow, board);
      el.appendChild(row);
      this.rows.push(row);
    }
    // rows that still show a wanted index stay where they are; the others take the rest
    const wanted = new Set(shelves);
    const free: HTMLDivElement[] = [];
    for (const r of this.rows) {
      const k = r.dataset['k'] ? Number(r.dataset['k']) : -1;
      if (wanted.has(k)) wanted.delete(k);
      else free.push(r);
    }
    for (const k of wanted) {
      const r = free.pop()!;
      r.dataset['k'] = String(k);
      r.style.top = `${top + k * l.rowHeight}px`;
      r.hidden = false;
    }
    for (const r of free) {
      r.hidden = true;
      r.dataset['k'] = '';
    }
  }

  /** Board rows shown, as row indices (tests). */
  shownRows(): number[] {
    return this.rows
      .filter((r) => !r.hidden && r.dataset['k'])
      .map((r) => Number(r.dataset['k']))
      .sort((a, b) => a - b);
  }

  remove(): void {
    this.element.remove();
  }
}
