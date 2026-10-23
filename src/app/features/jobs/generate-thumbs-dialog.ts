import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { describeFsError } from '../../core/errors/fs-error';
import { DialogService } from '../../shared/dialog/dialog.service';
import { Modal } from '../../shared/dialog/modal';
import { CategoriesStore } from '../categories/categories.store';
import { formatDuration } from './job-time';
import { JOBS_TEXTS } from './jobs-texts';
import { ThumbsJobStore } from './thumbs-job.store';

/** `''` = all categories. */
type Scope = string;

/**
 * „Generate thumbnails“ (design 007 E7): choose a category or all, start; progress with
 * counts, current book, times; pause / resume / cancel; the result with the failed books.
 * Closing the dialog does not stop the job.
 */
@Component({
  selector: 'app-generate-thumbs-dialog',
  imports: [Modal],
  templateUrl: './generate-thumbs-dialog.html',
  styleUrl: './generate-thumbs-dialog.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GenerateThumbsDialog {
  protected readonly job = inject(ThumbsJobStore);
  protected readonly categories = inject(CategoriesStore);
  private readonly dialogs = inject(DialogService);
  protected readonly t = JOBS_TEXTS;
  protected readonly duration = formatDuration;
  protected readonly describe = describeFsError;

  /** Default: the active category. */
  protected readonly scope = signal<Scope>(this.categories.active()?.id ?? '');

  protected readonly errorText = computed(() => {
    const e = this.job.error();
    return e ? describeFsError(e) : '';
  });
  protected readonly resultText = computed(() => {
    const p = this.job.progress();
    if (this.job.phase() !== 'done' || !p) return '';
    if (this.job.cancelled()) return this.t.cancelledMessage(p.generated);
    // an unreadable category is an error, not „nothing to do“ (review 007 #5)
    if (p.total === 0 && p.errors === 0) return this.t.nothingToDo;
    return this.t.doneMessage(p.generated);
  });

  protected start(): void {
    const s = this.scope();
    void this.job.start(s ? [s] : []);
  }

  private readonly startButton = viewChild<ElementRef<HTMLButtonElement>>('startButton');

  /** Back to the form, the focus on „Start“ (E2E 007: it was lost with the old buttons). */
  protected again(): void {
    this.job.reset();
    setTimeout(() => this.startButton()?.nativeElement.focus());
  }

  protected close(): void {
    this.dialogs.close();
  }
}
