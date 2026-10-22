/**
 * „Filter series“ (legacy §6 `extractSeriesFilter`): the file name without extension, everything
 * before the first number or ` -` / ` (` / `_<number>`, every word as `+word`. Works on the
 * book's `name` (from Rust) – no path is split here.
 */
export function extractSeriesFilter(name: string): string {
  if (!name) return '';
  let series = name;
  const dot = series.lastIndexOf('.');
  if (dot > 0) series = series.substring(0, dot);
  const match = series.match(/^(.*?)(?:\s\d+|_\d+|\s-|\s\()/);
  if (match) series = match[1];
  return series
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => `+${w}`)
    .join(' ');
}
