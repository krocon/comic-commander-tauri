import { invoke, isTauri } from '@tauri-apps/api/core';
import { FsError, toFsError } from '../errors/fs-error';

const NO_BACKEND: FsError = {
  code: 'backend_unavailable',
  message: 'desktop backend is not available',
};

/**
 * The only place that calls `invoke()`. Used by the `Tauri*Api` facades in `core/` – never by
 * components or stores. Every rejection becomes an `FsError`.
 */
export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw NO_BACKEND;
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    throw toFsError(e);
  }
}
