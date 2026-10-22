//! DTOs shared with the frontend. Keep in sync by hand with
//! `src/app/core/scan/scan.models.ts` (and `about.models.ts`); every change on both
//! sides plus a test.

use serde::{Deserialize, Serialize};

/// The container kind of a book **by extension**, serialised in lower case (`"cbz"`, …).
/// `.zip` → `cbz`, `.rar` → `cbr`, `.7z` → `cb7`, `.tar` → `cbt` (design 002 E3); the real
/// format is detected from the content when a book is read (prompt 003).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
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

/// One comic book found in a category.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookEntry {
    /// `fnv64(path)` as 16 hex digits – addresses the book in cover URLs (design 003 E1).
    pub id: String,
    /// Full path – opaque for the frontend (never split or joined there).
    pub path: String,
    /// Path below the category's `baseDir`, segments joined with `/`. For display, filter and sort
    /// only – never turned back into a file system path.
    pub rel_path: String,
    /// File name with extension.
    pub name: String,
    pub format: BookFormat,
    pub size: u64,
    /// Modification time in ms since the epoch, if the file system tells it.
    pub modified_ms: Option<i64>,
}

/// Statistics of one scan (design 002).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanStats {
    pub books: u64,
    pub dirs: u64,
    /// Folders that could not be read (permissions, vanished) – the scan goes on.
    pub unreadable_dirs: u64,
    /// Entries left out: names that are not valid UTF-8, entries that vanished.
    pub skipped_entries: u64,
    /// Symbolic links to folders – never followed (design 002 E2).
    pub skipped_dir_links: u64,
    /// Symbolic links whose target is missing.
    pub broken_links: u64,
    /// `true` when the scan stopped at [`crate::scan::MAX_BOOKS`].
    pub truncated: bool,
    pub duration_ms: u64,
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
