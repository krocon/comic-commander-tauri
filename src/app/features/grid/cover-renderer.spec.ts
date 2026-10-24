import { AreaModelIf } from '@guiexpert/table';
import { book } from '../../../testing/fixtures';
import { BookEntry } from '../../core/scan/scan.models';
import { CoverRenderer, displayTitle } from './cover-renderer';
import { bookLeft, shelfLayout } from './shelf-math';
import { GridItem, GroupItem } from './grouping';

function render(
  b: BookEntry | GridItem | undefined,
  src: string | null,
  focused = false,
  progress: number | null = null,
) {
  const failed: string[] = [];
  const r = new CoverRenderer({
    src: () => src,
    failed: (x) => failed.push(x.id),
    isFocused: () => focused,
    coverHeight: () => 300,
    progress: () => progress,
    title: (i) => (i.kind === 'book' ? i.book.relPath : i.label),
  });
  const cell = document.createElement('div');
  const item: GridItem | undefined =
    b === undefined || 'kind' in b ? b : { kind: 'book', id: b.id, book: b };
  const cleanup = r.render(cell, 0, 0, 'body', {} as AreaModelIf, item);
  return { cell, failed, cleanup };
}

function group(over: Partial<GroupItem> = {}): GroupItem {
  const cover = book('A/Asterix 01.cbz');
  return {
    kind: 'group',
    group: 'series',
    id: 's:asterix',
    key: 'asterix',
    label: 'Asterix',
    cover,
    count: 12,
    total: 12,
    read: 0,
    progress: null,
    newestMs: 0,
    ...over,
  };
}

describe('CoverRenderer', () => {
  it('shows image, format and tooltip – names never as HTML', () => {
    const evil = book('x/<img src=x onerror="alert(1)">.cbz', { format: 'cbr' });
    const { cell } = render(evil, 'cccover://localhost/c1.a.0?v=0', true);
    const cover = cell.querySelector('.cc-cover') as HTMLElement;
    expect(cover.classList.contains('cc-focus')).toBe(true);
    expect(cover.title).toBe(evil.relPath);
    expect(cover.style.height).toBe('300px');
    expect(cell.querySelectorAll('img').length).toBe(1);
    expect(cell.querySelector('img')!.getAttribute('src')).toBe('cccover://localhost/c1.a.0?v=0');
    expect(cell.querySelector('.cc-format')!.textContent).toBe('CBR');
    expect(cell.innerHTML).not.toContain('onerror="alert');
  });

  it('keeps the format when the image fails, reports it once', () => {
    const b = book('a.cbz');
    const { cell, failed, cleanup } = render(b, 'fake:a');
    const img = cell.querySelector('img')!;
    img.dispatchEvent(new Event('error'));
    img.dispatchEvent(new Event('error'));
    expect(failed).toEqual([b.id]);
    expect(cell.querySelector('img')).toBeNull();
    expect(cell.querySelector('.cc-format')!.textContent).toBe('CBZ');
    cleanup?.();
  });

  it('draws nothing for an empty cell and no image without src', () => {
    expect(render(undefined, 'x').cell.childElementCount).toBe(0);
    expect(render(book('a.cbz'), null).cell.querySelector('img')).toBeNull();
  });

  it('shows the reading progress as a bar (design 005 E5)', () => {
    expect(render(book('a.cbz'), 'x').cell.querySelector('.cc-progress')).toBeNull();
    const bar = render(book('a.cbz'), 'x', false, 12 / 48).cell.querySelector(
      '.cc-progress > div',
    ) as HTMLElement;
    expect(bar.style.width).toBe('25%');
    const full = render(book('a.cbz'), null, false, 1.7).cell.querySelector(
      '.cc-progress > div',
    ) as HTMLElement;
    expect(full.style.width).toBe('100%');
  });

  it('draws a group: cover of the first book, count, name as text (design 011)', () => {
    const evil = group({ label: '<b onclick="x()">Serie</b>', count: 3, total: 12 });
    const { cell, failed } = render(evil, 'cccover://c1.a.0', true, 0.5);
    const tile = cell.querySelector('.cc-cover') as HTMLElement;
    expect(tile.classList.contains('cc-group')).toBe(true);
    expect(tile.classList.contains('cc-series')).toBe(true);
    expect(tile.classList.contains('cc-focus')).toBe(true);
    expect(cell.querySelector('.cc-count')!.textContent).toBe('3/12');
    expect(cell.querySelector('.cc-name')!.textContent).toBe('<b onclick="x()">Serie</b>');
    expect(cell.querySelector('.cc-name b')).toBeNull();
    expect(tile.title).toBe(evil.label);
    expect((cell.querySelector('.cc-progress > div') as HTMLElement).style.width).toBe('50%');
    cell.querySelector('img')!.dispatchEvent(new Event('error'));
    expect(failed).toEqual([evil.cover.id]);
  });

  it('a folder tile has a folder icon, all books = one number', () => {
    const { cell } = render(group({ group: 'folder', id: 'd:A', label: 'A' }), null);
    expect(cell.querySelector('.cc-folder')).not.toBeNull();
    expect(cell.querySelector('.cc-name .fa-folder')).not.toBeNull();
    expect(cell.querySelector('.cc-count')!.textContent).toBe('12');
  });
});

describe('CoverRenderer – shelf look (design 015)', () => {
  const layout = shelfLayout(768, { width: 100, height: 150 });

  function shelfRender(item: GridItem, src: string | null, focused = false) {
    const failed: string[] = [];
    const r = new CoverRenderer({
      src: () => src,
      failed: (x) => failed.push(x.id),
      isFocused: () => focused,
      coverHeight: () => 150,
      progress: () => 0.5,
      title: (i) => (i.kind === 'book' ? i.book.relPath : i.label),
      shelf: () => layout,
    });
    const cell = document.createElement('div');
    r.render(cell, 0, 4, 'body', {} as AreaModelIf, item);
    return { cell, failed, r };
  }
  const asItem = (b: BookEntry): GridItem => ({ kind: 'book', id: b.id, book: b });

  it('stands the book at its column on the board, the box of the cover size', () => {
    const b = book('A/Asterix 01.cbz');
    const { cell } = shelfRender(asItem(b), 'cccover://x/1', true);
    const slot = cell.querySelector('.cc-shelf-slot') as HTMLElement;
    expect(slot.style.left).toBe(`${bookLeft(layout, 4)}px`);
    expect(slot.style.bottom).toBe(`${layout.bookBottom}px`);
    expect(slot.title).toBe(b.relPath);
    const el = slot.querySelector('.cc-book') as HTMLElement;
    expect(el.classList.contains('cc-focus')).toBe(true);
    expect(el.style.width).toBe('100px');
    expect(el.style.height).toBe('150px');
    expect(el.querySelector('.cc-progress > div')!.getAttribute('style')).toContain('50%');
    expect(el.querySelector('.cc-ring')).not.toBeNull();
  });

  it('fits the loaded cover in its real aspect and remembers the size', () => {
    const b = book('A/Wide.cbz');
    const { cell, r } = shelfRender(asItem(b), 'cccover://x/wide');
    const img = cell.querySelector('img')!;
    Object.defineProperty(img, 'naturalWidth', { value: 300 });
    Object.defineProperty(img, 'naturalHeight', { value: 300 });
    img.dispatchEvent(new Event('load'));
    const el = cell.querySelector('.cc-book') as HTMLElement;
    expect(el.style.width).toBe('100px');
    expect(el.style.height).toBe('100px');
    expect(el.classList.contains('cc-loaded')).toBe(true);
    // a repaint knows the size at once
    const again = document.createElement('div');
    r.render(again, 0, 0, 'body', {} as AreaModelIf, asItem(b));
    expect((again.querySelector('.cc-book') as HTMLElement).style.height).toBe('100px');
    expect(again.querySelector('.cc-book')!.classList.contains('cc-loaded')).toBe(true);
  });

  it('a book without a cover: linen with the title as text, never as HTML', () => {
    const evil = book('x/<b onmouseover="x()">Bad</b>.cbr', { format: 'cbr' });
    const { cell } = shelfRender(asItem(evil), null);
    const el = cell.querySelector('.cc-book') as HTMLElement;
    expect(el.classList.contains('cc-blank')).toBe(true);
    expect(el.querySelector('.cc-label')!.textContent).toBe(displayTitle(evil.name));
    expect(el.querySelector('.cc-author')!.textContent).toBe('CBR');
    expect(cell.innerHTML).not.toContain('onmouseover="x()"');
    expect(cell.querySelector('img')).toBeNull();
  });

  it('a failed cover turns into the linen book and is reported', () => {
    const b = book('A/Broken.cbz');
    const { cell, failed } = shelfRender(asItem(b), 'cccover://x/broken');
    cell.querySelector('img')!.dispatchEvent(new Event('error'));
    expect(failed).toEqual([b.id]);
    expect(cell.querySelector('.cc-blank .cc-label')!.textContent).toBe('Broken');
    expect(cell.querySelector('img')).toBeNull();
  });

  it('a group: stack, count and name on the cover', () => {
    const { cell } = shelfRender(group({ count: 3, total: 12 }), 'cccover://x/g');
    const el = cell.querySelector('.cc-book') as HTMLElement;
    expect(el.classList.contains('cc-group')).toBe(true);
    expect(el.querySelector('.cc-count')!.textContent).toBe('3/12');
    expect(el.querySelector('.cc-name')!.textContent).toBe('Asterix');
  });

  it('displayTitle drops only the extension', () => {
    expect(displayTitle('Asterix 01 - Der Gallier.cbz')).toBe('Asterix 01 - Der Gallier');
    expect(displayTitle('.hidden')).toBe('.hidden');
    expect(displayTitle('no-ext')).toBe('no-ext');
  });
});
