import { Injectable } from '@angular/core';
import { JobsApi } from '../app/core/jobs/jobs-api';
import { FsError } from '../app/core/errors/fs-error';
import { JobEvent, ThumbsProgress } from '../app/core/jobs/jobs.models';

/** Test double of `JobsApi` (never import in app code): records calls, `emit` sends events. */
@Injectable()
export class FakeJobsApi extends JobsApi {
  readonly calls: string[] = [];
  emit: (event: JobEvent) => void = () => undefined;
  failWith: FsError | null = null;
  private seq = 0;

  startGenerateThumbs(categoryIds: string[], onEvent: (event: JobEvent) => void): Promise<string> {
    this.calls.push(`start ${categoryIds.join(',') || '*'}`);
    if (this.failWith) return Promise.reject(this.failWith);
    this.emit = onEvent;
    return Promise.resolve(`thumbs-${++this.seq}`);
  }

  pause(jobId: string, paused: boolean): Promise<void> {
    this.calls.push(`${paused ? 'pause' : 'resume'} ${jobId}`);
    return Promise.resolve();
  }

  cancel(jobId: string): Promise<void> {
    this.calls.push(`cancel ${jobId}`);
    return Promise.resolve();
  }
}

export function progress(overrides: Partial<ThumbsProgress> = {}): ThumbsProgress {
  return {
    total: 0,
    processed: 0,
    generated: 0,
    skipped: 0,
    errors: 0,
    currentFile: null,
    elapsedMs: 0,
    paused: false,
    ready: [],
    ...overrides,
  };
}
