/**
 * Times of a job (design 007 E8, like the old app): `h:mm:ss` and a linear estimate of the
 * time left. Pure.
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/**
 * Time left, linear from the work done so far; `null` while there is too little to say
 * (nothing done yet, or less than two seconds of work).
 */
export function remainingMs(processed: number, total: number, elapsedMs: number): number | null {
  if (total <= 0 || processed <= 0 || elapsedMs < 2000) return null;
  if (processed >= total) return 0;
  return Math.round((elapsedMs / processed) * (total - processed));
}

export function percent(processed: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.floor((processed / total) * 100));
}
