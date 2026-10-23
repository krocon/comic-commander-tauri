import { Injectable } from '@angular/core';
import { Channel } from '@tauri-apps/api/core';
import { call } from '../backend/call';
import { JobEvent } from './jobs.models';

/** Typed facade of the job commands (design 007); tests bind `FakeJobsApi`. */
export abstract class JobsApi {
  /** Starts making the missing covers of `categoryIds` (empty = all); returns the job id. */
  abstract startGenerateThumbs(
    categoryIds: string[],
    onEvent: (event: JobEvent) => void,
  ): Promise<string>;
  abstract pause(jobId: string, paused: boolean): Promise<void>;
  abstract cancel(jobId: string): Promise<void>;
}

@Injectable()
export class TauriJobsApi extends JobsApi {
  startGenerateThumbs(categoryIds: string[], onEvent: (event: JobEvent) => void): Promise<string> {
    const channel = new Channel<JobEvent>();
    channel.onmessage = onEvent;
    return call<string>('start_generate_thumbs', { categoryIds, onEvent: channel });
  }

  pause(jobId: string, paused: boolean): Promise<void> {
    return call<void>('pause_job', { jobId, paused });
  }

  cancel(jobId: string): Promise<void> {
    return call<void>('cancel_job', { jobId });
  }
}
