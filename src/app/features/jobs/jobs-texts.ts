/**
 * Texts of the jobs (English = source; German follows in prompt 009).
 */
const n = (v: number) => v.toLocaleString('en');

export const JOBS_TEXTS = {
  thumbsTitle: 'Generate thumbnails',
  thumbsIntro:
    'Makes the missing covers in all sizes, so the grid scrolls without waiting. The app stays usable; you may close this dialog.',
  scope: 'Categories',
  allCategories: 'All categories',
  start: 'Start',
  pause: 'Pause',
  resume: 'Resume',
  cancel: 'Cancel',
  close: 'Close',
  again: 'Run again',
  counting: (found: number, existing: number) =>
    `Counting… ${n(found)} missing, ${n(existing)} there already`,
  progressLabel: 'Progress',
  counts: (processed: number, total: number) => `${n(processed)} / ${n(total)}`,
  generated: 'Made',
  skipped: 'No image',
  errors: 'Errors',
  elapsed: 'Elapsed',
  remaining: 'Left',
  current: 'Now',
  paused: 'Paused',
  doneMessage: (generated: number) =>
    generated === 1 ? '1 thumbnail was generated.' : `${n(generated)} thumbnails were generated.`,
  cancelledMessage: (generated: number) => `Cancelled – ${n(generated)} generated so far.`,
  nothingToDo: 'All covers are there already.',
  errorListTitle: (count: number) => `Books that failed (${n(count)})`,
  toolbar: (percent: number) => `Thumbnails ${percent} %`,
  toolbarCounting: 'Thumbnails: counting…',
  menuItem: 'Generate thumbnails…',
};
