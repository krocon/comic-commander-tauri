import { AreaIdent, AreaModelIf, CellRendererIf, RendererCleanupFnType } from '@guiexpert/table';
import { BookEntry } from '../../core/scan/scan.models';

/** What the renderer asks the grid (design 004). */
export interface CoverCellContext {
  /** `src` of the cover, `null` = only the format (failed, waiting for a retry). */
  src(book: BookEntry): string | null;
  failed(book: BookEntry): void;
  isFocused(book: BookEntry): boolean;
  /** Height of a cover – row 0 is higher (padding below the floating toolbar). */
  coverHeight(): number;
}

/**
 * One cover in a cell of the GuiExpert cover grid – plain DOM, no Angular (faster, CLAUDE.md §5).
 * Names are user data: only `textContent` and attributes, never `innerHTML`. The cover sits at
 * the bottom of its cell (row 0 is `paddingTop` higher). Below the image the format (CBZ …) is
 * visible while it loads or when it failed.
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
    const book = cellValue as BookEntry | undefined;
    if (!book) return undefined;
    const doc = cellDiv.ownerDocument;
    const cover = doc.createElement('div');
    cover.className = this.ctx.isFocused(book) ? 'cc-cover cc-focus' : 'cc-cover';
    cover.style.height = `${this.ctx.coverHeight()}px`;
    cover.title = book.relPath;
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
    cellDiv.appendChild(cover);
    return () => img?.removeEventListener('error', onError);
  }
}
