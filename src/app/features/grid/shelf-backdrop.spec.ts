import { ShelfBackdrop } from './shelf-backdrop';
import { shelfLayout } from './shelf-math';

describe('ShelfBackdrop (design 015 E2)', () => {
  const l = shelfLayout(768, { width: 100, height: 150 });

  it('draws wall, side walls and boards for the visible part, as tall as the content', () => {
    const b = new ShelfBackdrop(document);
    document.body.appendChild(b.element);
    b.update(l, 56, 0, 1000, 753, 20000);
    const el = b.element;
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelectorAll('.cc-shelf-wall').length).toBe(1);
    expect(el.querySelectorAll('.cc-shelf-upright').length).toBe(2);
    expect(el.style.width).toBe('753px');
    expect(el.style.height).toBe('20000px');
    expect(el.style.getPropertyValue('--shelf-row')).toBe('192px');
    // rows 0…5 cover 0…1000 (+ one row margin)
    expect(b.shownRows()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const rows = [...el.querySelectorAll<HTMLElement>('.cc-shelf-row')];
    const row1 = rows.find((r) => r.dataset['k'] === '1')!;
    expect(row1.style.top).toBe('248px');
    expect(row1.querySelector('.cc-shelf-board')).not.toBeNull();
    b.remove();
    expect(el.isConnected).toBe(false);
  });

  it('keeps boards in place while scrolling, recycles the ones that left the view', () => {
    const b = new ShelfBackdrop(document);
    b.update(l, 56, 0, 1000, 753, 20000);
    const rows = [...b.element.querySelectorAll<HTMLElement>('.cc-shelf-row')];
    const row2 = rows.find((r) => r.dataset['k'] === '2')!;
    b.update(l, 56, 300, 1000, 753, 20000);
    // row 2 is still in view: untouched
    expect(row2.dataset['k']).toBe('2');
    expect(row2.style.top).toBe(`${56 + 2 * 192}px`);
    expect(b.shownRows()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    b.update(l, 56, 5000, 1000, 753, 20000);
    expect(b.shownRows()[0]).toBe(24);
    expect(b.element.querySelectorAll('.cc-shelf-row').length).toBe(8);
  });

  it('a short list: boards down to the bottom of the window', () => {
    const b = new ShelfBackdrop(document);
    b.update(l, 56, 0, 600, 753, 300);
    expect(b.element.style.height).toBe('600px');
    expect(b.shownRows()).toEqual([0, 1, 2, 3, 4]); // one row beyond the window
  });
});
