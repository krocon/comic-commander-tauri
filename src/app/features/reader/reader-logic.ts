/**
 * Pure logic of the reader (design 005): keys, steps, click zones, swipes, target widths and the
 * layout of the continuous mode. No Angular, no DOM – tested in `reader-logic.spec.ts`.
 */

export type ReaderMode = 'single' | 'continuous';
export type ReaderFit = 'width' | 'height';

export type ReaderCommand =
  | 'next'
  | 'prev'
  | 'first'
  | 'last'
  | 'toggleMode'
  | 'toggleFit'
  | 'toggleRtl'
  | 'nextBook'
  | 'prevBook'
  | 'fullscreen'
  | 'close';

// The keys are actions since design 008 (`core/actions/keymap.base.json`, context `reader`).

/** Part of the screen that stays visible when scrolling one screen (legacy: one screen). */
export const OVERLAP = 0.1;

export type Step = { kind: 'scroll'; top: number } | { kind: 'page' };

/**
 * One step forward (`1`) or back (`-1`) in a page higher than the screen: first scroll one
 * screen (keeping {@link OVERLAP} of it), at the edge turn the page (legacy §7).
 */
export function step(
  dir: 1 | -1,
  scrollTop: number,
  viewHeight: number,
  contentHeight: number,
): Step {
  const max = Math.max(0, contentHeight - viewHeight);
  const by = Math.max(1, Math.round(viewHeight * (1 - OVERLAP)));
  if (dir > 0 && scrollTop < max - 1) return { kind: 'scroll', top: Math.min(max, scrollTop + by) };
  if (dir < 0 && scrollTop > 1) return { kind: 'scroll', top: Math.max(0, scrollTop - by) };
  return { kind: 'page' };
}

/** Click into the left / right third (legacy §7); mirrored for manga. */
export function clickZone(x: number, width: number, rtl: boolean): 'next' | 'prev' | null {
  if (width <= 0) return null;
  const third = x < width / 3 ? 'left' : x > (width * 2) / 3 ? 'right' : null;
  if (third === null) return null;
  return (third === 'right') !== rtl ? 'next' : 'prev';
}

/** Least horizontal travel of a swipe. */
export const SWIPE_MIN = 50;

/** A horizontal swipe: to the left = on (manga: back). */
export function swipe(dx: number, dy: number, rtl: boolean): 'next' | 'prev' | null {
  if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 !== rtl ? 'next' : 'prev';
}

/** Target widths of the page URLs in device pixels (Rust `reader::url::WIDTHS`, E2). */
export const PAGE_WIDTHS = [1024, 1600, 2048, 2560, 3200, 4096] as const;

/**
 * The width to ask for: enough for both fits (`max(width, height) × dpr`), rounded up to a
 * step so that the URL stays the same for small window changes; beyond the last step: 0 =
 * original.
 */
export function widthBucket(cssWidth: number, cssHeight: number, dpr: number): number {
  const need = Math.max(cssWidth, cssHeight) * (dpr > 0 ? dpr : 1);
  if (need <= 0) return 0;
  return PAGE_WIDTHS.find((w) => w >= need) ?? 0;
}

/** Aspect (height / width) used when a page's size is not known yet: the comic format. */
export const DEFAULT_ASPECT = 1.5;

/**
 * Aspect of every page: known ones as they are, unknown ones like the nearest known page before
 * them (else after them, else {@link DEFAULT_ASPECT}) – a guess that rarely jumps.
 */
export function aspects(sizes: readonly ({ width: number; height: number } | null)[]): number[] {
  const own = sizes.map((s) => (s && s.width > 0 && s.height > 0 ? s.height / s.width : null));
  const firstKnown = own.find((a) => a !== null) ?? DEFAULT_ASPECT;
  let last = firstKnown;
  return own.map((a) => {
    if (a !== null) last = a;
    return a ?? last;
  });
}

/** Gap between pages in the continuous mode (px). */
export const PAGE_GAP = 4;

export interface PageBox {
  top: number;
  width: number;
  height: number;
}

/**
 * Boxes of the continuous mode: `fit = width` → every page as wide as the view; `height` →
 * every page fits the view height (at most as wide as the view).
 */
export function layoutPages(
  pageAspects: readonly number[],
  viewWidth: number,
  viewHeight: number,
  fit: ReaderFit,
): { boxes: PageBox[]; total: number } {
  let top = 0;
  const boxes = pageAspects.map((a) => {
    const width = Math.max(
      1,
      Math.floor(fit === 'height' ? Math.min(viewWidth, viewHeight / a) : viewWidth),
    );
    const box = { top, width, height: Math.round(width * a) };
    top += box.height + PAGE_GAP;
    return box;
  });
  return { boxes, total: Math.max(0, top - PAGE_GAP) };
}

/** The page at `y` (the last page whose top is ≤ y). */
export function pageAt(boxes: readonly PageBox[], y: number): number {
  let lo = 0;
  let hi = boxes.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (boxes[mid].top <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Pages to render: those in view plus `margin` px above and below. */
export function visibleRange(
  boxes: readonly PageBox[],
  scrollTop: number,
  viewHeight: number,
  margin: number,
): [number, number] {
  if (boxes.length === 0) return [0, -1];
  const from = pageAt(boxes, Math.max(0, scrollTop - margin));
  const to = pageAt(boxes, scrollTop + viewHeight + margin);
  return [Math.max(0, from), Math.max(from, to)];
}

/** Reading position in the continuous mode: a page and how far into it (0…1). */
export interface Anchor {
  index: number;
  fraction: number;
}

export function anchorOf(boxes: readonly PageBox[], scrollTop: number): Anchor {
  const index = Math.max(0, pageAt(boxes, scrollTop));
  const b = boxes[index];
  if (!b) return { index: 0, fraction: 0 };
  return {
    index,
    fraction: b.height > 0 ? Math.min(1, Math.max(0, (scrollTop - b.top) / b.height)) : 0,
  };
}

export function scrollTopOf(boxes: readonly PageBox[], anchor: Anchor): number {
  const b = boxes[Math.min(anchor.index, boxes.length - 1)];
  return b ? Math.round(b.top + anchor.fraction * b.height) : 0;
}

/** The page that counts as „current“ in the continuous mode: the one at a third of the view. */
export function currentPage(
  boxes: readonly PageBox[],
  scrollTop: number,
  viewHeight: number,
): number {
  return Math.max(0, pageAt(boxes, scrollTop + viewHeight / 3));
}

/** Page to start with: the remembered one – a finished book starts again at the beginning. */
export function startPage(lastPage: number | null, pages: number): number {
  if (lastPage === null || lastPage < 0 || lastPage >= pages - 1) return 0;
  return lastPage;
}

/** Pages to load ahead (design 005 Anforderung 2): the next three, the one before. */
export function prefetchPages(page: number, pages: number): number[] {
  return [page + 1, page + 2, page + 3, page - 1].filter((i) => i >= 0 && i < pages);
}
