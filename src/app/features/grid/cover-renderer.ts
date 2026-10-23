import { AreaIdent, AreaModelIf, CellRendererIf, RendererCleanupFnType } from '@guiexpert/table';
import { BookEntry } from '../../core/scan/scan.models';
import { GridItem } from './grouping';

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
}
