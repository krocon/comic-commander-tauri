//! DTOs shared with the frontend. Keep in sync by hand with
//! `src/app/core/library/library.models.ts` (and `about.models.ts`); every change on both
//! sides plus a test.

use serde::Serialize;

/// The kinds of comic books we know. Serialised in lower case (`"cbz"`, …).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BookFormat {
    /// ZIP archive with images.
    Cbz,
    /// RAR archive with images.
    Cbr,
    /// 7z archive with images.
    Cb7,
    /// TAR archive with images.
    Cbt,
    /// PDF document.
    Pdf,
}

/// One comic book found in a library.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookEntry {
    /// Full path – opaque for the frontend (never split or joined there).
    pub path: String,
    /// Path below the library root, segments joined with `/`. For display, filter and sort
    /// only – never turned back into a file system path.
    pub rel_path: String,
    /// File name with extension.
    pub name: String,
    pub format: BookFormat,
    pub size: u64,
    /// Modification time in ms since the epoch, if the file system tells it.
    pub modified_ms: Option<i64>,
}

/// The result of scanning one library folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryScan {
    /// The root as it was scanned (after `~` expansion).
    pub root: String,
    /// Books in natural order of `rel_path`.
    pub books: Vec<BookEntry>,
    /// Folders that could not be read (permissions, vanished) – the scan goes on.
    pub unreadable_dirs: u32,
    /// Entries left out: symbolic links, names that are not valid UTF-8.
    pub skipped_entries: u32,
    /// `true` when the scan stopped at [`crate::library::MAX_BOOKS`].
    pub truncated: bool,
}

/// Data for the About dialog.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub os: String,
    pub arch: String,
}
