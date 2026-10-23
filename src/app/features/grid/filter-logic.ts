/**
 * The filter of the cover grid (design 004, legacy §6): words separated by spaces, `+word` must
 * occur, `-word` must not occur, the other words: at least one of them (OR). Without case and
 * with NFC = NFD (`filterKey()` of `book-order.ts` for the books). A lone `+` or `-` is ignored.
 *
 * Deviation from the template: only the leading `+`/`-` is removed – the template removed every
 * `-` in a NOT word (`-spider-man` looked for `spiderman`).
 *
 * Design 011 E8: field terms `series:`, `year:`, `writer:`, `publisher:` (with `+`/`-` like
 * words, values with spaces in `"…"`), matched against `bookInfo()`. `year:` takes `2015` or
 * `2010-2015`. Unknown fields, an empty value or a year that is none stay plain words (searched
 * in the path as before) – old filters keep working.
 */
import { seriesKey } from './book-info';

export type FieldName = 'series' | 'year' | 'writer' | 'publisher';

export interface FieldTerm {
  field: FieldName;
  /** `series`: a series key; `writer`/`publisher`: NFC, lower case. */
  text: string;
  /** `year`: the range. */
  from: number;
  to: number;
}

export interface ParsedFilter {
  ors: string[];
  musts: string[];
  nots: string[];
  orFields: FieldTerm[];
  mustFields: FieldTerm[];
  notFields: FieldTerm[];
}

/** What a field term is matched against (`bookInfo()` of the book). */
export interface FieldValues {
  seriesKey: string | null;
  year: number | null;
  writer: string | null;
  publisher: string | null;
}

const TOKEN = /[+-]?(?:series|year|writer|publisher):"[^"]*"?|\S+/gu;
const FIELD = /^(series|year|writer|publisher):(.*)$/u;

function fieldTerm(body: string): FieldTerm | null {
  const m = FIELD.exec(body);
  if (!m) return null;
  let value = m[2];
  if (value.startsWith('"'))
    value = value.slice(1, value.endsWith('"') && value.length > 1 ? -1 : undefined);
  value = value.trim();
  if (!value) return null;
  const field = m[1] as FieldName;
  if (field === 'year') {
    const y = /^(\d{4})(?:-(\d{4}))?$/u.exec(value);
    if (!y) return null;
    const a = Number(y[1]);
    const b = y[2] ? Number(y[2]) : a;
    return { field, text: '', from: Math.min(a, b), to: Math.max(a, b) };
  }
  const text = field === 'series' ? seriesKey(value) : value;
  return text ? { field, text, from: 0, to: 0 } : null;
}

export function parseFilter(text: string): ParsedFilter {
  const f: ParsedFilter = {
    ors: [],
    musts: [],
    nots: [],
    orFields: [],
    mustFields: [],
    notFields: [],
  };
  const tokens = text.normalize('NFC').toLowerCase().match(TOKEN) ?? [];
  for (const t of tokens) {
    if (t === '+' || t === '-') continue;
    const sign = t[0] === '+' || t[0] === '-' ? t[0] : '';
    const body = sign ? t.slice(1) : t;
    const term = fieldTerm(body);
    if (term) {
      (sign === '+' ? f.mustFields : sign === '-' ? f.notFields : f.orFields).push(term);
    } else {
      (sign === '+' ? f.musts : sign === '-' ? f.nots : f.ors).push(body);
    }
  }
  return f;
}

export function isEmptyFilter(f: ParsedFilter): boolean {
  return (
    !f.ors.length &&
    !f.musts.length &&
    !f.nots.length &&
    !f.orFields.length &&
    !f.mustFields.length &&
    !f.notFields.length
  );
}

/** Does the filter use field terms (then the grid needs `bookInfo()`)? */
export function hasFieldTerms(f: ParsedFilter): boolean {
  return f.orFields.length > 0 || f.mustFields.length > 0 || f.notFields.length > 0;
}

function fieldMatches(t: FieldTerm, v: FieldValues | null): boolean {
  if (!v) return false;
  switch (t.field) {
    case 'series':
      return v.seriesKey !== null && v.seriesKey.includes(t.text);
    case 'year':
      return v.year !== null && v.year >= t.from && v.year <= t.to;
    case 'writer':
      return v.writer !== null && v.writer.normalize('NFC').toLowerCase().includes(t.text);
    case 'publisher':
      return v.publisher !== null && v.publisher.normalize('NFC').toLowerCase().includes(t.text);
  }
}

/** `key`: NFC, lower case (`filterKey()`); `values`: the book's fields, asked only when needed. */
export function matchesFilter(
  key: string,
  f: ParsedFilter,
  values?: () => FieldValues | null,
): boolean {
  let v: FieldValues | null | undefined;
  const get = () => (v === undefined ? (v = values?.() ?? null) : v);
  if (f.ors.length || f.orFields.length) {
    const any =
      f.ors.some((w) => key.includes(w)) || f.orFields.some((t) => fieldMatches(t, get()));
    if (!any) return false;
  }
  for (const w of f.musts) if (!key.includes(w)) return false;
  for (const w of f.nots) if (key.includes(w)) return false;
  for (const t of f.mustFields) if (!fieldMatches(t, get())) return false;
  for (const t of f.notFields) if (fieldMatches(t, get())) return false;
  return true;
}
