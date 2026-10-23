import { AreaModelIf } from '@guiexpert/table';
import { book } from '../../../testing/fixtures';
import { BookEntry } from '../../core/scan/scan.models';
import { CoverRenderer } from './cover-renderer';

function render(
  b: BookEntry | undefined,
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
  });
  const cell = document.createElement('div');
  const cleanup = r.render(cell, 0, 0, 'body', {} as AreaModelIf, b);
  return { cell, failed, cleanup };
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
});
