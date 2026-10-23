import { TestBed } from '@angular/core/testing';
import { CategoriesApi } from '../../core/categories/categories-api';
import { JobsApi } from '../../core/jobs/jobs-api';
import { FakeCategoriesApi } from '../../../testing/fake-categories-api';
import { FakeJobsApi, progress } from '../../../testing/fake-jobs-api';
import { category, config } from '../../../testing/fixtures';
import { DialogService } from '../../shared/dialog/dialog.service';
import { CategoriesStore } from '../categories/categories.store';
import { GenerateThumbsDialog } from './generate-thumbs-dialog';

const flush = () => new Promise((r) => setTimeout(r));

async function render() {
  TestBed.configureTestingModule({
    imports: [GenerateThumbsDialog],
    providers: [
      { provide: CategoriesApi, useClass: FakeCategoriesApi },
      { provide: JobsApi, useClass: FakeJobsApi },
    ],
  });
  const capi = TestBed.inject(CategoriesApi) as FakeCategoriesApi;
  capi.loaded = {
    config: config([category('c1'), category('c2', { title: 'Make' })], 'c2'),
    warning: null,
  };
  await TestBed.inject(CategoriesStore).load();
  const api = TestBed.inject(JobsApi) as FakeJobsApi;
  TestBed.inject(DialogService).show('thumbs');
  const fixture = TestBed.createComponent(GenerateThumbsDialog);
  document.body.appendChild(fixture.nativeElement);
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const update = async () => {
    await flush();
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const button = (text: string) =>
    [...el.querySelectorAll('button')].find(
      (b) => b.textContent!.trim() === text,
    ) as HTMLButtonElement;
  return { el, api, update, button };
}

describe('GenerateThumbsDialog', () => {
  it('starts for the active category, shows progress, pause and the result', async () => {
    const { el, api, update, button } = await render();
    expect(el.querySelector('[role=dialog]')).not.toBeNull();
    const checked = el.querySelector('input[type=radio]:checked') as HTMLInputElement;
    expect(checked.value).toBe('c2');
    button('Start').click();
    await update();
    expect(api.calls).toEqual(['start c2']);
    api.emit({ kind: 'counting', found: 3, existing: 1 });
    await update();
    expect(el.querySelector('[role=status]')!.textContent).toContain('3 missing, 1 there already');
    expect(el.querySelector('progress')!.hasAttribute('value')).toBe(false);
    api.emit({
      kind: 'progress',
      progress: progress({
        total: 4,
        processed: 1,
        generated: 1,
        currentFile: 'Hägar/Hägar 01.cbz',
        elapsedMs: 3000,
      }),
    });
    await update();
    expect(el.querySelector('progress')!.getAttribute('aria-valuetext')).toBe('25 %');
    expect(el.textContent).toContain('Now: Hägar/Hägar 01.cbz');
    expect(el.textContent).toContain('0:09'); // 3 s for 1 of 4 → 9 s left
    button('Pause').click();
    await update();
    expect(api.calls).toContain('pause thumbs-1');
    expect(button('Resume')).toBeTruthy();
    api.emit({
      kind: 'done',
      progress: progress({ total: 4, processed: 4, generated: 3, errors: 1 }),
      cancelled: false,
      errorList: [{ name: 'kaputt <b>.cbz', code: 'archive_error' }],
    });
    await update();
    expect(el.querySelector('[role=status]')!.textContent).toContain(
      '3 thumbnails were generated.',
    );
    const details = el.querySelector('details')!;
    expect(details.textContent).toContain('kaputt <b>.cbz');
    expect(details.textContent).toContain('damaged');
    expect(details.querySelector('b')).toBeNull();
  });

  it('all categories, cancel, and a refused start', async () => {
    const { el, api, update, button } = await render();
    (el.querySelector('input[value=""]') as HTMLInputElement).click();
    button('Start').click();
    await update();
    expect(api.calls).toEqual(['start *']);
    api.emit({ kind: 'progress', progress: progress({ total: 2 }) });
    await update();
    button('Cancel').click();
    await update();
    expect(api.calls).toContain('cancel thumbs-1');
    api.emit({
      kind: 'done',
      progress: progress({ total: 2, processed: 1, generated: 1 }),
      cancelled: true,
      errorList: [],
    });
    await update();
    expect(el.textContent).toContain('Cancelled – 1 generated so far.');
    button('Run again').click();
    await update();
    expect(document.activeElement?.textContent?.trim()).toBe('Start');
    api.failWith = { code: 'job_running', message: 'x' };
    button('Start').click();
    await update();
    expect(el.querySelector('[role=alert]')!.textContent).toContain('running already');
  });
});
