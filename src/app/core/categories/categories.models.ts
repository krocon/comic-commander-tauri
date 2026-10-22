/**
 * Categories (design 002) – mirror of Rust `categories.rs`/`legacy_import.rs`. Field names as in
 * the old comiccommander `config.json` (E10), plus `id`.
 */
export interface ThumbsDim {
  width: number;
  height: number;
  /** Suffix of the old sidecar thumbnails (`''` → `Band.jpg`, `'_xl'` → `Band_xl.jpg`). */
  nameExtension: string;
}

export interface Category {
  /** `c` + 12 hex; empty = new (the backend assigns one). */
  id: string;
  /** Empty → the backend uses the folder name. */
  title: string;
  /** Absolute path (or starting with `~`) – opaque. */
  baseDir: string;
  /** Lower case with dot, e.g. `['.cbz', '.cbr']`. */
  bookExtensions: string[];
  /** Font Awesome 4.5.0 name without `fa-`. */
  icon: string;
  thumbsDims: ThumbsDim[];
  dimIndex: number;
  initialFilter: string;
}

export interface CategoriesConfig {
  version: number;
  activeId: string | null;
  categories: Category[];
}

/** Problem with the config file (as in files-and-folders `config_file.rs`). */
export interface ConfigWarning {
  code: 'broken' | 'unreadable';
  path: string | null;
}

export interface CategoriesLoaded {
  config: CategoriesConfig;
  warning: ConfigWarning | null;
}

export type ImportNoteCode =
  | 'missing_dir'
  | 'unsupported_extension'
  | 'duplicate'
  | 'invalid_dims'
  | 'invalid_dir'
  | 'no_extension';

export interface ImportNote {
  /** Index into `LegacyImport.categories`; `null` = the category was left out. */
  index: number | null;
  title: string;
  code: ImportNoteCode;
  detail: string | null;
}

export interface LegacyImport {
  file: string;
  categories: Category[];
  notes: ImportNote[];
}
