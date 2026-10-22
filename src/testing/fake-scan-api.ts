import { Injectable } from '@angular/core';
import { ScanApi } from '../app/core/scan/scan-api';
import { ScanEvent } from '../app/core/scan/scan.models';

interface Opened {
  id: string;
  emit: (event: ScanEvent) => void;
}

/** Test double of `ScanApi` (never import in app code): the test emits the events. */
@Injectable()
export class FakeScanApi extends ScanApi {
  readonly opened: Opened[] = [];
  readonly cancelled: string[] = [];
  failOpen: unknown = null;

  open(categoryId: string, onEvent: (event: ScanEvent) => void): Promise<void> {
    if (this.failOpen) return Promise.reject(this.failOpen);
    this.opened.push({ id: categoryId, emit: onEvent });
    return Promise.resolve();
  }

  cancel(categoryId: string): Promise<void> {
    this.cancelled.push(categoryId);
    return Promise.resolve();
  }

  /** The emitter of the latest `open`. */
  get last(): Opened {
    const o = this.opened[this.opened.length - 1];
    if (!o) throw new Error('nothing opened');
    return o;
  }
}
