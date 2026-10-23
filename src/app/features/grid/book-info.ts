import { BookEntry } from '../../core/scan/scan.models';

/**
 * Series, number, title and year of a book (design 011 E4, E5): ComicInfo field by field, else
 * the name (heuristic of the template's `extractSeriesFilter`, extended), else – the name starts
 * with its number – the folder. Pure; one result per book object (WeakMap).
 *
 * The folder is the last segment of `relPath` before the name: `relPath` is defined as segments
 * joined with `/` for display (model.rs) – nothing here becomes a path again (E6).
 */
export interface NameInfo {
  series: string | null;
  /** As written (`01`, `1.5`, `12a`). */
  number: string | null;
  volume: number | null;
  title: string | null;
  year: number | null;
  /** The series is the folder's name (the name starts with its number). */
  fromFolder: boolean;
}

export interface BookInfo extends Omit<NameInfo, 'fromFolder'> {
  /** For grouping and `series:`: NFC, lower case, `_` = space, white space collapsed. */
  seriesKey: string | null;
  seriesSource: 'comicinfo' | 'name' | 'folder' | null;
  /** `01` → 1, `1.5` → 1.5, `12a` → 12. */
  numberValue: number | null;
  writer: string | null;
  publisher: string | null;
}

/** A number token: `01`, `1.5`, `1,5`, `12a` (one letter), magazines `01-2024`, `2024-05`. */
const NUM = String.raw`\d{1,4}[-/]\d{2,4}(?!\d)|\d+(?:[.,]\d+)?[a-z]?`;
/** Words before a number that are no part of the series. */
const MARKER = String.raw`(?:#|band|bd\.?|nr\.?|no\.?|heft|tome|tomo|t(?=\d)|issue|ausgabe|episode|ep\.?)`;
/** One number token with an optional marker, between spaces (or at the ends). */
const NUMBER_TOKEN = new RegExp(String.raw`(^|\s)(?:${MARKER}\s*)?(${NUM})(?=$|\s|[-–:,])`, 'giu');
const VOLUME = new RegExp(String.raw`(^|\s)(?:v|vol\.?|volume)\s*(\d{1,4})(?=$|\s|[-–:,])`, 'iu');
/** Bounded runs: unbounded ones are cubic on a long name without `)` (review 011 #7). */
const YEAR_IN_BRACKETS = /[([][^)\]]{0,80}?\b((?:19|20)\d{2})\b[^)\]]{0,80}[)\]]/u;
const EDGE = /^[\s\-–:.,_]+|[\s\-–:.,_]+$/gu;

function tidy(s: string): string {
  return s.replace(/\s+/gu, ' ').replace(EDGE, '').trim();
}

function orNull(s: string): string | null {
  const t = tidy(s);
  return t === '' ? null : t;
}

/** Text after a number: separators away, a run of further numbers too (`001 002 Titel`). */
function titleAfter(rest: string): string | null {
  let r = rest.replace(/^[\s\-–:.,]+/u, '');
  r = r.replace(new RegExp(String.raw`^(?:(?:${NUM})\s+)+(?=\D)`, 'iu'), '');
  return orNull(r);
}

/** The name heuristic: `name` with extension, `folder` = the folder it lies in (or `null`). */
export function parseBookName(name: string, folder: string | null): NameInfo {
  const empty: NameInfo = {
    series: null,
    number: null,
    volume: null,
    title: null,
    year: null,
    fromFolder: false,
  };
  if (!name) return empty;
  let stem = name;
  const dot = stem.lastIndexOf('.');
  if (dot > 0) stem = stem.substring(0, dot);
  stem = stem.normalize('NFC').replace(/_/gu, ' ').replace(/\s+/gu, ' ').trim();

  const yearMatch = YEAR_IN_BRACKETS.exec(stem);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  // tags in brackets end the interesting part: `(Verlag 2015) (digital)`
  const bracket = stem.search(/[([]/u);
  let core = bracket > 0 ? stem.substring(0, bracket) : stem;

  // a volume (`v2`, `Vol. 3`) is taken out first
  let volume: number | null = null;
  let volumeAt = -1;
  const vm = VOLUME.exec(core);
  if (vm && vm.index + vm[1].length > 0) {
    volume = Number(vm[2]);
    volumeAt = vm.index + vm[1].length;
    core = core.substring(0, vm.index) + ' ' + core.substring(vm.index + vm[0].length);
  }

  const tokens = [...core.matchAll(NUMBER_TOKEN)].map((m) => ({
    start: m.index + m[1].length,
    end: m.index + m[0].length,
    number: m[2],
  }));
  const folderName = folder ? tidy(folder.normalize('NFC').replace(/_/gu, ' ')) : null;

  if (tokens.length === 0) {
    const series = orNull(volumeAt >= 0 ? core.substring(0, volumeAt) : core);
    return {
      ...empty,
      series: series ?? folderName,
      volume,
      title: volumeAt >= 0 ? titleAfter(core.substring(volumeAt)) : null,
      year,
      fromFolder: !series && folderName !== null,
    };
  }

  const first = tokens[0];
  if (first.start === 0 && tokens.length === 1) {
    // `005 Bessy Im Tal …` in the folder `Bessy`: number first, series from the folder
    let rest = titleAfter(core.substring(first.end)) ?? '';
    if (
      folderName &&
      rest.toLowerCase().startsWith(folderName.toLowerCase()) &&
      /^(?:$|[\s\-–:,.])/u.test(rest.substring(folderName.length))
    ) {
      rest = rest.substring(folderName.length);
    }
    return {
      series: folderName,
      number: first.number,
      volume,
      title: orNull(rest),
      year,
      fromFolder: folderName !== null,
    };
  }
  // `100 Bullets 001`: a leading number belongs to the series when another one follows
  const num = first.start === 0 ? tokens[1] : first;
  // the marker (`Band`, `#`) is part of the token, not of the series
  const series = orNull(core.substring(0, num.start));
  return {
    series: series ?? folderName,
    number: num.number,
    volume,
    title: titleAfter(core.substring(num.end)),
    year,
    fromFolder: !series && folderName !== null,
  };
}

/** The key series are grouped and filtered by. */
export function seriesKey(series: string | null): string | null {
  if (!series) return null;
  // without `"`: „Filter series“ writes the series in quotes (review 011 #8)
  const k = tidy(series.normalize('NFC').toLowerCase().replace(/[_"]/gu, ' '));
  return k === '' ? null : k;
}

/** `01` → 1, `1,5` → 1.5, `12a` → 12, `01-2024` / `2024-01` → 202401; else `null`. */
export function numberValue(n: string | null): number | null {
  if (!n) return null;
  const monthYear = /^\s*(\d{1,2})[-/](\d{4})\s*$/u.exec(n);
  if (monthYear) return Number(monthYear[2]) * 100 + Number(monthYear[1]);
  const yearMonth = /^\s*(\d{4})[-/](\d{1,2})\s*$/u.exec(n);
  if (yearMonth) return Number(yearMonth[1]) * 100 + Number(yearMonth[2]);
  const m = /^\s*(\d+(?:[.,]\d+)?)/u.exec(n);
  return m ? Number(m[1].replace(',', '.')) : null;
}

/** The folder the book lies in (display segment of `relPath`), `null` at the top. */
export function folderOf(book: BookEntry): string | null {
  const parts = book.relPath.split('/');
  return parts.length > 1 ? parts[parts.length - 2] : null;
}

const cache = new WeakMap<BookEntry, BookInfo>();

/** ComicInfo field by field before the name (E5). */
export function bookInfo(book: BookEntry): BookInfo {
  let info = cache.get(book);
  if (info) return info;
  const folder = folderOf(book);
  const byName = parseBookName(book.name, folder);
  const m = book.meta ?? {};
  const series = m.series ?? byName.series;
  const number = m.number ?? byName.number;
  info = {
    series,
    seriesKey: seriesKey(series),
    seriesSource: m.series
      ? 'comicinfo'
      : series === null
        ? null
        : byName.fromFolder
          ? 'folder'
          : 'name',
    number,
    numberValue: numberValue(number),
    volume: m.volume ?? byName.volume,
    title: m.title ?? byName.title,
    year: m.year ?? byName.year,
    writer: m.writer ?? null,
    publisher: m.publisher ?? null,
  };
  cache.set(book, info);
  return info;
}
