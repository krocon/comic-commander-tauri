/**
 * Texts of the reader (English = source; German follows in prompt 009).
 */
export const READER_TEXTS = {
  back: 'Back to the covers',
  backKey: 'Esc',
  page: (n: number, count: number) => `Page ${n} of ${count}`,
  pageCount: (n: number, count: number) => `${n} / ${count}`,
  slider: 'Go to page',
  loading: 'Opening the book …',
  unpacking: 'Unpacking …',
  modeSingle: 'Single page (S)',
  modeContinuous: 'Continuous (S)',
  fitWidth: 'Fit width (W)',
  fitHeight: 'Fit height (W)',
  manga: 'Right to left (M)',
  fullscreen: 'Full screen (F11)',
  nextBook: 'Next book (])',
  prevBook: 'Previous book ([)',
  pageFailed: 'This page cannot be shown.',
  retry: 'Try again',
  bookFailed: 'This book cannot be read.',
  openExternal: 'Open with default app',
  readerLabel: (name: string) => `Reader: ${name}`,
  firstOfList: 'This is the first book of the list.',
  lastOfList: 'This is the last book of the list.',
};
