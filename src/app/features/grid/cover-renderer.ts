import { AreaIdent, AreaModelIf, CellRendererIf, RendererCleanupFnType } from '@guiexpert/table';
import { BookEntry } from '../../core/scan/scan.models';
import { GridItem } from './grouping';
import { bookLeft, fitCover, ShelfLayout } from './shelf-math';
import { Size } from './grid-math';

/** What the renderer asks the grid (design 004, 011). */
export interface CoverCellContext {
  /** `src` of the cover, `null` = only the format (failed, waiting for a retry). */
  src(book: BookEntry): string | null;
  failed(book: BookEntry): void;
  isFocused(item: GridItem): boolean;
  /** Height of a cover – row 0 is higher (padding below the floating toolbar). */
  coverHeight(): number;
  /** Part read (0…1) or `null` (never opened) – design 005 E5; groups: mean (011 E10). */
  progress(item: GridItem): number | null;
  /** Tooltip (book: path + series line, design 011). */
  title(item: GridItem): string;
  /** The shelf look (design 015): its layout, `null`/missing = the grid. */
  shelf?(): ShelfLayout | null;
}

/** Natural sizes of loaded covers, so a repaint sizes the book at once (no flicker). */
const MAX_SIZES = 20_000;

/** The name without its extension – the title on a book without a cover (design 015). */
export function displayTitle(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * One tile in a cell of the GuiExpert cover grid – plain DOM, no Angular (faster, CLAUDE.md §5).
 * Names are user data: only `textContent` and attributes, never `innerHTML`. The cover sits at
 * the bottom of its cell (row 0 is `paddingTop` higher). Below the image the format (CBZ …) is
 * visible while it loads or when it failed.
 *
 * A group (design 011 E2) is the cover of its first book as a stack, with the number of books
 * and its name over a gradient at the bottom (folders with a folder icon).
 */
export class CoverRenderer implements CellRendererIf {
  private readonly sizes = new Map<string, Size>();

  constructor(private readonly ctx: CoverCellContext) {}

  render(
    cellDiv: HTMLDivElement,
    _rowIndex: number,
    _columnIndex: number,
    _areaIdent: AreaIdent,
    _areaModel: AreaModelIf,
    cellValue: unknown,
  ): RendererCleanupFnType | undefined {
    const item = cellValue as GridItem | undefined;
    if (!item) return undefined;
    const shelf = this.ctx.shelf?.() ?? null;
    if (shelf) return this.renderBook(cellDiv, _columnIndex, item, shelf);
    const book = item.kind === 'book' ? item.book : item.cover;
    const doc = cellDiv.ownerDocument;
    const cover = doc.createElement('div');
    cover.className = 'cc-cover';
    if (item.kind === 'group') cover.classList.add('cc-group', `cc-${item.group}`);
    if (this.ctx.isFocused(item)) cover.classList.add('cc-focus');
    cover.style.height = `${this.ctx.coverHeight()}px`;
    cover.title = this.ctx.title(item);
    const format = doc.createElement('span');
    format.className = 'cc-format';
    format.textContent = book.format.toUpperCase();
    cover.appendChild(format);
    const src = this.ctx.src(book);
    let img: HTMLImageElement | null = null;
    const onError = () => {
      img?.remove();
      this.ctx.failed(book);
    };
    if (src) {
      img = doc.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.draggable = false;
      img.addEventListener('error', onError, { once: true });
      img.src = src;
      cover.appendChild(img);
    }
    if (item.kind === 'group') {
      const count = doc.createElement('span');
      count.className = 'cc-count';
      count.textContent =
        item.count === item.total
          ? item.total.toLocaleString('en')
          : `${item.count.toLocaleString('en')}/${item.total.toLocaleString('en')}`;
      cover.appendChild(count);
      const name = doc.createElement('span');
      name.className = 'cc-name';
      if (item.group === 'folder') {
        const icon = doc.createElement('i');
        icon.className = 'fa fa-folder';
        icon.setAttribute('aria-hidden', 'true');
        name.appendChild(icon);
      }
      name.appendChild(doc.createTextNode(item.label));
      cover.appendChild(name);
    }
    const progress = this.ctx.progress(item);
    if (progress !== null) {
      const bar = doc.createElement('div');
      bar.className = 'cc-progress';
      const fill = doc.createElement('div');
      fill.style.width = `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`;
      bar.appendChild(fill);
      cover.appendChild(bar);
    }
    cellDiv.appendChild(cover);
    return () => img?.removeEventListener('error', onError);
  }

  /**
   * The shelf look (design 015): a book standing on the board – its real aspect fitted into the
   * cover box, placed at its column's position (`bookLeft`). Without a cover (failed, not made
   * yet) a linen binding with the title on a label, like the books without a cover in img.png.
   */
  private renderBook(
    cellDiv: HTMLDivElement,
    col: number,
    item: GridItem,
    l: ShelfLayout,
  ): RendererCleanupFnType | undefined {
    const book = item.kind === 'book' ? item.book : item.cover;
    const doc = cellDiv.ownerDocument;
    const slot = doc.createElement('div');
    slot.className = 'cc-shelf-slot';
    slot.style.setProperty('--s', String(l.s));
    slot.style.left = `${bookLeft(l, col)}px`;
    slot.style.bottom = `${l.bookBottom}px`;
    slot.style.width = `${l.coverWidth}px`;
    slot.style.height = `${l.coverHeight}px`;
    slot.title = this.ctx.title(item);

    const el = doc.createElement('div');
    el.className = 'cc-book';
    if (item.kind === 'group') el.classList.add('cc-group', `cc-${item.group}`);
    if (this.ctx.isFocused(item)) el.classList.add('cc-focus');
    const box = { width: l.coverWidth, height: l.coverHeight };
    const setSize = (sz: Size) => {
      el.style.width = `${sz.width}px`;
      el.style.height = `${sz.height}px`;
    };
    setSize(box);

    const src = this.ctx.src(book);
    let img: HTMLImageElement | null = null;
    const blank = () => {
      el.classList.add('cc-blank');
      const label = doc.createElement('div');
      label.className = 'cc-label';
      label.textContent = item.kind === 'group' ? item.label : displayTitle(book.name);
      const author = doc.createElement('div');
      author.className = 'cc-author';
      author.textContent = book.format.toUpperCase();
      el.prepend(label, author);
    };
    const onLoad = () => {
      if (!img) return;
      const n = { width: img.naturalWidth, height: img.naturalHeight };
      if (src && n.width > 0) {
        if (this.sizes.size >= MAX_SIZES) this.sizes.clear();
        this.sizes.set(src, n);
      }
      setSize(fitCover(n, box));
      el.classList.add('cc-loaded');
    };
    const onError = () => {
      img?.remove();
      img = null;
      blank();
      this.ctx.failed(book);
    };
    if (src) {
      img = doc.createElement('img');
      img.alt = '';
      img.decoding = 'async';
      img.draggable = false;
      const known = this.sizes.get(src);
      if (known) {
        setSize(fitCover(known, box));
        el.classList.add('cc-loaded');
      } else {
        img.addEventListener('load', onLoad, { once: true });
      }
      img.addEventListener('error', onError, { once: true });
      img.src = src;
      el.appendChild(img);
    } else {
      blank();
    }

    if (item.kind === 'group') {
      const count = doc.createElement('span');
      count.className = 'cc-count';
      count.textContent =
        item.count === item.total
          ? item.total.toLocaleString('en')
          : `${item.count.toLocaleString('en')}/${item.total.toLocaleString('en')}`;
      el.appendChild(count);
      if (src) {
        const name = doc.createElement('span');
        name.className = 'cc-name';
        if (item.group === 'folder') {
          const icon = doc.createElement('i');
          icon.className = 'fa fa-folder';
          icon.setAttribute('aria-hidden', 'true');
          name.appendChild(icon);
        }
        name.appendChild(doc.createTextNode(item.label));
        el.appendChild(name);
      }
    }
    const progress = this.ctx.progress(item);
    if (progress !== null) {
      const bar = doc.createElement('div');
      bar.className = 'cc-progress';
      const fill = doc.createElement('div');
      fill.style.width = `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`;
      bar.appendChild(fill);
      el.appendChild(bar);
    }
    const ring = doc.createElement('div');
    ring.className = 'cc-ring';
    el.appendChild(ring);
    slot.appendChild(el);
    cellDiv.appendChild(slot);
    return () => {
      img?.removeEventListener('load', onLoad);
      img?.removeEventListener('error', onError);
    };
  }
}
