/**
 * Pure logic of the reader (design 005, 014): steps, click zones, swipes, zoom, rotation, target
 * widths and the layout of the pages. No Angular, no DOM – tested in `reader-logic.spec.ts`.
 */

export type ReaderMode = 'single' | 'continuous';

export type ReaderCommand =
  | 'next'
  | 'prev'
  | 'first'
  | 'last'
  | 'toggleMode'
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

/** Target widths of the page URLs in device pixels (Rust `reader::url::WIDTHS`, 005 E2). */
export const PAGE_WIDTHS = [1024, 1600, 2048, 2560, 3200, 4096] as const;

// ---- zoom and rotation (design 014) ----------------------------------------------------------

export interface Size {
  width: number;
  height: number;
}

/** Zoom modes (014 E6): four fits plus a free factor. */
export type ZoomMode = 'width' | 'height' | 'page' | 'full' | 'custom';
/** `factor` counts only for `custom`: CSS width = image width × factor. */
export interface Zoom {
  mode: ZoomMode;
  factor: number;
}
export type FitMode = Exclude<ZoomMode, 'custom'>;
/** Degrees clockwise, the whole book (014 E8). */
export type Rotation = 0 | 90 | 180 | 270;

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 8;
export const ZOOM_CYCLE: readonly FitMode[] = ['width', 'height', 'page', 'full'];
export const DEFAULT_ZOOM: Zoom = { mode: 'width', factor: 1 };
/** Size used when no page size is known yet: the comic format. */
export const DEFAULT_SIZE: Size = { width: 1000, height: 1500 };

export function clampFactor(f: number): number {
  if (!Number.isFinite(f) || f <= 0) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, f));
}

/** A rotation from anything (stored state): unknown → 0. */
export function toRotation(r: unknown): Rotation {
  return r === 90 || r === 180 || r === 270 ? r : 0;
}

/** 90° on (`1`, clockwise) or back (`-1`). */
export function rotate(r: Rotation, dir: 1 | -1): Rotation {
  return ((((r + dir * 90) % 360) + 360) % 360) as Rotation;
}

/** The next fit mode (`W` / `Shift+W`); from `custom` forward = the first, back = the last. */
export function nextZoom(z: Zoom, dir: 1 | -1): Zoom {
  const i = ZOOM_CYCLE.indexOf(z.mode as FitMode);
  const n = ZOOM_CYCLE.length;
  const next = i < 0 ? (dir > 0 ? 0 : n - 1) : (i + dir + n) % n;
  return { mode: ZOOM_CYCLE[next], factor: z.factor };
}

/** Steps of zoom in / out (like browsers). */
export const ZOOM_STEPS = [
  0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8,
] as const;

/** The next step above (`1`) or below (`-1`) the factor `f` (2 % tolerance). */
export function zoomStep(f: number, dir: 1 | -1): number {
  const cur = clampFactor(f);
  if (dir > 0) return ZOOM_STEPS.find((s) => s > cur * 1.02) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((s) => s < cur / 1.02) ?? ZOOM_MIN;
}

/** CSS size of a page: the image (unturned) and the box it needs (turned). */
export interface PageFit {
  imgWidth: number;
  imgHeight: number;
  width: number;
  height: number;
  /** CSS pixels per image pixel. */
  scale: number;
}

/**
 * Fits a page of natural size `nat` into the view (014 E2, E3): `width` → as wide as the view,
 * `height` → as high (wide pages scroll sideways), `page` → wholly visible, `full` → one image
 * pixel per CSS pixel, `custom` → the factor. Rotated by 90° / 270° the sides swap.
 */
export function fitPage(
  nat: Size,
  rot: Rotation,
  zoom: Zoom,
  viewW: number,
  viewH: number,
): PageFit {
  const nw = nat.width > 0 ? nat.width : DEFAULT_SIZE.width;
  const nh = nat.height > 0 ? nat.height : DEFAULT_SIZE.height;
  const turned = rot % 180 !== 0;
  const w = turned ? nh : nw;
  const h = turned ? nw : nh;
  const vw = Math.max(0, viewW);
  const vh = Math.max(0, viewH);
  let scale: number;
  switch (zoom.mode) {
    case 'width':
      scale = vw / w;
      break;
    case 'height':
      scale = vh / h;
      break;
    case 'page':
      scale = Math.min(vw / w, vh / h);
      break;
    case 'full':
      scale = 1;
      break;
    default:
      scale = clampFactor(zoom.factor);
  }
  if (!Number.isFinite(scale) || scale < 0) scale = 0;
  const width = Math.max(1, Math.floor(w * scale));
  const height = Math.max(1, Math.floor(h * scale));
  return {
    width,
    height,
    imgWidth: turned ? height : width,
    imgHeight: turned ? width : height,
    scale,
  };
}

/**
 * The width to ask for (014, replaces 005's one width for all pages): the image's CSS width ×
 * `dpr`, rounded up to a step so that the URL stays the same for small changes; beyond the last
 * step, and always for `full`: 0 = the original.
 */
export function pageWidth(fit: PageFit, dpr: number, zoom: Zoom): number {
  if (zoom.mode === 'full') return 0;
  const need = fit.imgWidth * (dpr > 0 ? dpr : 1);
  if (need <= 0) return 0;
  return PAGE_WIDTHS.find((w) => w >= need) ?? 0;
}

/**
 * Size of every page: known ones as they are, unknown ones like the nearest known page before
 * them (else after them, else {@link DEFAULT_SIZE}) – a guess that rarely jumps.
 */
export function guessSizes(sizes: readonly (Size | null)[]): Size[] {
  const own = sizes.map((s) => (s && s.width > 0 && s.height > 0 ? s : null));
  let last: Size = own.find((s) => s !== null) ?? DEFAULT_SIZE;
  return own.map((s) => {
    if (s !== null) last = s;
    return { width: (s ?? last).width, height: (s ?? last).height };
  });
}

/** Gap between pages in the continuous mode (px). */
export const PAGE_GAP = 4;

export interface PageBox extends PageFit {
  top: number;
}

/**
 * Boxes of the continuous mode: every page fitted by {@link fitPage}, one below the other;
 * `maxWidth` = the widest box (pages may be wider than the view: horizontal scrolling).
 */
export function layoutPages(
  sizes: readonly Size[],
  viewWidth: number,
  viewHeight: number,
  zoom: Zoom,
  rot: Rotation,
): { boxes: PageBox[]; total: number; maxWidth: number } {
  let top = 0;
  let maxWidth = 0;
  const boxes = sizes.map((s) => {
    const box = { top, ...fitPage(s, rot, zoom, viewWidth, viewHeight) };
    top += box.height + PAGE_GAP;
    maxWidth = Math.max(maxWidth, box.width);
    return box;
  });
  return { boxes, total: Math.max(0, top - PAGE_GAP), maxWidth };
}

export interface ScrollPos {
  left: number;
  top: number;
}

export type Step2d = { kind: 'scroll'; left: number; top: number } | { kind: 'page' };

/**
 * One step in a page larger than the view in both directions (014 Anforderung 4): forward
 * first sideways in reading direction (manga: to the left), at the end of a row back to its
 * start one screen down, at the very end `page`; back mirrored. Without horizontal overflow it
 * is {@link step}.
 */
export function step2d(
  dir: 1 | -1,
  pos: ScrollPos,
  view: Size,
  content: Size,
  rtl: boolean,
): Step2d {
  const maxX = Math.max(0, content.width - view.width);
  if (maxX <= 1) {
    const s = step(dir, pos.top, view.height, content.height);
    return s.kind === 'page' ? s : { kind: 'scroll', left: pos.left, top: s.top };
  }
  const maxY = Math.max(0, content.height - view.height);
  const byX = Math.max(1, Math.round(view.width * (1 - OVERLAP)));
  const byY = Math.max(1, Math.round(view.height * (1 - OVERLAP)));
  // reading direction: from `start` to `end` of a row
  const start = rtl ? maxX : 0;
  const end = rtl ? 0 : maxX;
  const towards = (from: number, to: number) =>
    to > from ? Math.min(to, from + byX) : Math.max(to, from - byX);
  const at = (x: number, target: number) => Math.abs(x - target) <= 1;
  if (dir > 0) {
    if (!at(pos.left, end)) return { kind: 'scroll', left: towards(pos.left, end), top: pos.top };
    if (pos.top < maxY - 1)
      return { kind: 'scroll', left: start, top: Math.min(maxY, pos.top + byY) };
    return { kind: 'page' };
  }
  if (!at(pos.left, start)) return { kind: 'scroll', left: towards(pos.left, start), top: pos.top };
  if (pos.top > 1) return { kind: 'scroll', left: end, top: Math.max(0, pos.top - byY) };
  return { kind: 'page' };
}

/** New scroll position after zooming by `k` so that `point` (in view coordinates) stays put. */
export function zoomAround(pos: ScrollPos, point: { x: number; y: number }, k: number): ScrollPos {
  return {
    left: Math.max(0, (pos.left + point.x) * k - point.x),
    top: Math.max(0, (pos.top + point.y) * k - point.y),
  };
}

/** Range of the zoom slider (014 E7): 0…1000, logarithmic from {@link ZOOM_MIN} to {@link ZOOM_MAX}. */
export const SLIDER_MAX = 1000;

export function sliderToFactor(v: number): number {
  const t = Math.min(SLIDER_MAX, Math.max(0, v)) / SLIDER_MAX;
  return clampFactor(ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, t));
}

export function factorToSlider(f: number): number {
  return Math.round(
    (Math.log(clampFactor(f) / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN)) * SLIDER_MAX,
  );
}

/** Snaps to one of `snaps` within ±`tolerance` (relative), e.g. 100 % and the last fit. */
export function snapFactor(f: number, snaps: readonly number[], tolerance = 0.03): number {
  for (const s of snaps) {
    if (s > 0 && Math.abs(f / s - 1) <= tolerance) return s;
  }
  return f;
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
