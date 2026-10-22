/**
 * The filter of the cover grid (design 004, legacy §6): words separated by spaces, `+word` must
 * occur, `-word` must not occur, the other words: at least one of them (OR). Without case and
 * with NFC = NFD (`filterKey()` of `book-order.ts` for the books). A lone `+` or `-` is ignored.
 *
 * Deviation from the template: only the leading `+`/`-` is removed – the template removed every
 * `-` in a NOT word (`-spider-man` looked for `spiderman`).
 */
export interface ParsedFilter {
  ors: string[];
  musts: string[];
  nots: string[];
}

export function parseFilter(text: string): ParsedFilter {
  const words = text
    .normalize('NFC')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== '' && w !== '+' && w !== '-');
  return {
    ors: words.filter((w) => !w.startsWith('+') && !w.startsWith('-')),
    musts: words.filter((w) => w.startsWith('+')).map((w) => w.slice(1)),
    nots: words.filter((w) => w.startsWith('-')).map((w) => w.slice(1)),
  };
}

export function isEmptyFilter(f: ParsedFilter): boolean {
  return !f.ors.length && !f.musts.length && !f.nots.length;
}

/** `key`: NFC, lower case (`filterKey()`). */
export function matchesFilter(key: string, f: ParsedFilter): boolean {
  if (f.ors.length && !f.ors.some((w) => key.includes(w))) return false;
  for (const w of f.musts) if (!key.includes(w)) return false;
  for (const w of f.nots) if (key.includes(w)) return false;
  return true;
}
