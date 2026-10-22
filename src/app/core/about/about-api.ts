import { Injectable } from '@angular/core';
import { call } from '../backend/call';
import { AppInfo } from './about.models';

/** Typed facade of `get_app_info`. */
export abstract class AboutApi {
  abstract appInfo(): Promise<AppInfo>;
}

@Injectable()
export class TauriAboutApi extends AboutApi {
  appInfo(): Promise<AppInfo> {
    return call<AppInfo>('get_app_info');
  }
}
