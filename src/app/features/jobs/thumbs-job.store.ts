import { computed, inject, Injectable, signal } from '@angular/core';
import { FsError, toFsError } from '../../core/errors/fs-error';
import { JobsApi } from '../../core/jobs/jobs-api';
import { JobEvent, ReadyBook, ThumbError, ThumbsProgress } from '../../core/jobs/jobs.models';
import { percent, remainingMs } from './job-time';

export type ThumbsPhase = 'idle' | 'starting' | 'counting' | 'running' | 'done' | 'failed';

/**
 * The batch job „generate thumbnails“ (design 007) – a root service: the job runs on while the
 * dialog is closed, the toolbar shows its progress, the grid draws finished covers again.
 * Events of an older run are dropped.
 */
@Injectable({ providedIn: 'root' })
export class ThumbsJobStore {
  private readonly api = inject(JobsApi);

  readonly phase = signal<ThumbsPhase>('idle');
  readonly jobId = signal<string | null>(null);
  /** While counting: missing so far / there already. */
  readonly counting = signal<{ found: number; existing: number }>({ found: 0, existing: 0 });
  readonly progress = signal<ThumbsProgress | null>(null);
  readonly cancelled = signal(false);
  readonly errorList = signal<ThumbError[]>([]);
  readonly error = signal<FsError | null>(null);
  /** The covers finished last (a new array per event – the grid reacts). */
  readonly ready = signal<readonly ReadyBook[]>([]);

  readonly running = computed(() => ['starting', 'counting', 'running'].includes(this.phase()));
  /** Paused before the first progress event (while counting). */
  private readonly pausedEarly = signal(false);
  readonly paused = computed(() => this.progress()?.paused ?? this.pausedEarly());
  readonly percent = computed(() => {
    const p = this.progress();
    return p ? percent(p.processed, p.total) : 0;
  });
  readonly remainingMs = computed(() => {
    const p = this.progress();
    return p && this.phase() === 'running' && !p.paused
      ? remainingMs(p.processed, p.total, p.elapsedMs)
      : null;
  });

  private run = 0;

  async start(categoryIds: string[]): Promise<void> {
    if (this.running()) return;
    const run = ++this.run;
    this.phase.set('starting');
    this.counting.set({ found: 0, existing: 0 });
    this.progress.set(null);
    this.cancelled.set(false);
    this.pausedEarly.set(false);
    this.errorList.set([]);
    this.error.set(null);
    try {
      const id = await this.api.startGenerateThumbs(categoryIds, (e) => {
        if (run === this.run) this.onEvent(e);
      });
      // `done` of an empty run may come before the answer (review 007 #8)
      if (run === this.run && this.running()) this.jobId.set(id);
    } catch (e) {
      if (run !== this.run) return;
      this.error.set(toFsError(e));
      this.phase.set('failed');
    }
  }

  private onEvent(e: JobEvent): void {
    switch (e.kind) {
      case 'counting':
        this.counting.set({ found: e.found, existing: e.existing });
        if (this.phase() === 'starting') this.phase.set('counting');
        return;
      case 'progress':
        this.progress.set(e.progress);
        this.phase.set('running');
        if (e.progress.ready.length) this.ready.set(e.progress.ready);
        return;
      case 'done':
        this.progress.set(e.progress);
        if (e.progress.ready.length) this.ready.set(e.progress.ready);
        this.cancelled.set(e.cancelled);
        this.errorList.set(e.errorList);
        this.phase.set('done');
        this.jobId.set(null);
        return;
      case 'failed':
        this.error.set(e.error);
        this.phase.set('failed');
        this.jobId.set(null);
        return;
    }
  }

  async setPaused(paused: boolean): Promise<void> {
    const id = this.jobId();
    if (!id) return;
    // shown at once; the next event confirms it
    this.pausedEarly.set(paused);
    this.progress.update((p) => (p ? { ...p, paused } : p));
    await this.api.pause(id, paused).catch(() => undefined);
  }

  async cancel(): Promise<void> {
    const id = this.jobId();
    if (id) await this.api.cancel(id).catch(() => undefined);
  }

  /** Back to the start form (after a finished run). */
  reset(): void {
    if (this.running()) return;
    this.phase.set('idle');
    this.progress.set(null);
    this.errorList.set([]);
    this.error.set(null);
  }
}
