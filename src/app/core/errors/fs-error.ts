/**
 * Errors from the backend: `FsError { code, message, path }` (Rust `error.rs`). New codes go
 * into both files and into `describeFsError()`. The UI never shows Rust's `message`.
 */
export type FsErrorCode =
  | 'not_found'
  | 'permission_denied'
  | 'not_a_directory'
  | 'invalid_path'
  | 'no_home_directory'
  | 'io'
  | 'invalid_categories'
  | 'invalid_legacy_config'
  | 'unknown_category'
  /** Frontend only: no Tauri backend (e.g. `pnpm start` in a browser). */
  | 'backend_unavailable'
  /** Frontend only: something that is no `FsError` was thrown. */
  | 'unknown';

export interface FsError {
  code: FsErrorCode;
  message: string;
  path?: string | null;
}

const KNOWN: readonly FsErrorCode[] = [
  'not_found',
  'permission_denied',
  'not_a_directory',
  'invalid_path',
  'no_home_directory',
  'io',
  'invalid_categories',
  'invalid_legacy_config',
  'unknown_category',
  'backend_unavailable',
  'unknown',
];

export function isFsError(value: unknown): value is FsError {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<FsError>;
  return typeof v.code === 'string' && typeof v.message === 'string';
}

/** Whatever was thrown → an `FsError` (unknown codes become `unknown`). */
export function toFsError(value: unknown): FsError {
  if (isFsError(value)) {
    return KNOWN.includes(value.code) ? value : { ...value, code: 'unknown' };
  }
  const message = value instanceof Error ? value.message : String(value);
  return { code: 'unknown', message };
}

/** User-facing text for an error (English; catalogues and German follow in prompt 009). */
export function describeFsError(error: FsError): string {
  switch (error.code) {
    case 'not_found':
      return 'The folder does not exist.';
    case 'permission_denied':
      return 'Access denied.';
    case 'not_a_directory':
      return 'This is not a folder.';
    case 'invalid_path':
      return 'Please enter an absolute path (or one starting with ~).';
    case 'no_home_directory':
      return 'Your home folder could not be determined.';
    case 'io':
      return 'The folder could not be read.';
    case 'invalid_categories':
      return 'The categories could not be saved – please check the entries.';
    case 'invalid_legacy_config':
      return 'This file is no configuration of the old Comic Commander.';
    case 'unknown_category':
      return 'This category no longer exists.';
    case 'backend_unavailable':
      return 'The desktop backend is not available (running in a browser?).';
    case 'unknown':
      return 'Something went wrong.';
  }
}
