import { TestBed } from '@angular/core/testing';
import { JobsApi } from '../../core/jobs/jobs-api';
import { FakeJobsApi, progress } from '../../../testing/fake-jobs-api';
import { ThumbsJobStore } from './thumbs-job.store';

function setup() {
  TestBed.configureTestingModule({ providers: [{ provide: JobsApi, useClass: FakeJobsApi }] });
  return { store: TestBed.inject(ThumbsJobStore), api: TestBed.inject(JobsApi) as FakeJobsApi };
}

describe('ThumbsJobStore', () => {
  it('counts, runs and finishes', async () => {
    const { store, api } = setup();
    await store.start(['c1']);
    expect(api.calls).toEqual(['start c1']);
    expect(store.jobId()).toBe('thumbs-1');
    expect(store.phase()).toBe('starting');
    api.emit({ kind: 'counting', found: 5, existing: 2 });
    expect(store.phase()).toBe('counting');
    expect(store.counting()).toEqual({ found: 5, existing: 2 });
    api.emit({
      kind: 'progress',
      progress: progress({
        total: 10,
        processed: 4,
        elapsedMs: 8000,
        ready: [{ categoryId: 'c1', bookId: 'b1' }],
      }),
    });
    expect(store.phase()).toBe('running');
    expect(store.percent()).toBe(40);
    expect(store.remainingMs()).toBe(12_000);
    expect(store.ready()).toEqual([{ categoryId: 'c1', bookId: 'b1' }]);
    expect(store.running()).toBe(true);
    api.emit({
      kind: 'done',
      progress: progress({ total: 10, processed: 10, generated: 8, errors: 2 }),
      cancelled: false,
      errorList: [{ name: 'kaputt.cbz', code: 'archive_error' }],
    });
    expect(store.phase()).toBe('done');
    expect(store.running()).toBe(false);
    expect(store.errorList().length).toBe(1);
    expect(store.jobId()).toBeNull();
    store.reset();
    expect(store.phase()).toBe('idle');
  });

  it('pauses, resumes and cancels the running job', async () => {
    const { store, api } = setup();
    await store.start([]);
    api.emit({ kind: 'progress', progress: progress({ total: 3 }) });
    await store.setPaused(true);
    expect(store.paused()).toBe(true);
    expect(store.remainingMs()).toBeNull();
    await store.setPaused(false);
    await store.cancel();
    expect(api.calls).toEqual(['start *', 'pause thumbs-1', 'resume thumbs-1', 'cancel thumbs-1']);
    api.emit({
      kind: 'done',
      progress: progress({ total: 3, processed: 1 }),
      cancelled: true,
      errorList: [],
    });
    expect(store.cancelled()).toBe(true);
  });

  it('a second start while running does nothing; a refused start is shown', async () => {
    const { store, api } = setup();
    await store.start([]);
    await store.start([]);
    expect(api.calls.length).toBe(1);
    api.emit({ kind: 'failed', error: { code: 'io', message: 'x' } });
    expect(store.phase()).toBe('failed');
    api.failWith = { code: 'job_running', message: 'x' };
    await store.start([]);
    expect(store.error()?.code).toBe('job_running');
  });

  it('drops events of an older run', async () => {
    const { store, api } = setup();
    await store.start([]);
    const old = api.emit;
    api.emit({ kind: 'done', progress: progress(), cancelled: false, errorList: [] });
    await store.start([]);
    old({ kind: 'progress', progress: progress({ total: 99 }) });
    expect(store.progress()).toBeNull();
  });

  it('pause while counting shows at once; a done before the id leaves no stale id', async () => {
    const { store, api } = setup();
    const started = store.start([]);
    api.emit({ kind: 'done', progress: progress(), cancelled: false, errorList: [] });
    await started;
    expect(store.jobId()).toBeNull();
    await store.start([]);
    api.emit({ kind: 'counting', found: 1, existing: 0 });
    await store.setPaused(true);
    expect(store.paused()).toBe(true);
  });
});
