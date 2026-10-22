import { Injectable } from '@angular/core';
import { Channel } from '@tauri-apps/api/core';
import { call } from '../backend/call';
import { ScanEvent } from './scan.models';

/** Typed facade of the scan commands; tests bind `FakeScanApi`. */
export abstract class ScanApi {
  /** Sends the cache (if any) and scans the category; all results arrive as events. */
  abstract open(categoryId: string, onEvent: (event: ScanEvent) => void): Promise<void>;
  abstract cancel(categoryId: string): Promise<void>;
}

@Injectable()
export class TauriScanApi extends ScanApi {
  open(categoryId: string, onEvent: (event: ScanEvent) => void): Promise<void> {
    const channel = new Channel<ScanEvent>();
    channel.onmessage = onEvent;
    return call<void>('open_category', { id: categoryId, onEvent: channel });
  }

  cancel(categoryId: string): Promise<void> {
    return call<void>('cancel_scan', { id: categoryId });
  }
}
