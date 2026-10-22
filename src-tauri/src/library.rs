//! Scanning a library folder for comic books (walking skeleton, prompt 001).
//!
//! Pure `std`, no Tauri – unit-tested with `tempfile`. Rules:
//! - recursive, iterative (no stack overflow on deep trees);
//! - symbolic links are **not** followed (no cycles, no escaping the library) and counted in
//!   `skipped_entries` – prompt 002 decides whether to follow them with a visited set;
//! - hidden entries (`.name`) and macOS AppleDouble files (`._name`) are left out – the old
//!   sidecar thumbnails live in `.Panels/` and are found by the cover code, not the scan;
//! - names that are not valid UTF-8 are skipped (cannot round-trip through JSON);
//! - unreadable folders are counted, the scan goes on; only an unusable *root* is an error;
//! - at most [`MAX_BOOKS`] books, then `truncated`.
//!
//! Caching, background refresh and cancelling follow in prompt 002.

use crate::error::{FsError, FsErrorCode};
use crate::model::{BookEntry, BookFormat, LibraryScan};
use crate::paths::rel_display;
use std::cmp::Ordering;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Upper bound of books per scan.
pub const MAX_BOOKS: usize = 500_000;

/// Extension (lower case, without dot) → format.
pub const BOOK_EXT: &[(&str, BookFormat)] = &[
    ("cbz", BookFormat::Cbz),
    ("cbr", BookFormat::Cbr),
    ("cb7", BookFormat::Cb7),
    ("cbt", BookFormat::Cbt),
    ("pdf", BookFormat::Pdf),
];

/// The book format of a file name, by extension (case-insensitive).
pub fn format_of(name: &str) -> Option<BookFormat> {
    let (_, ext) = name.rsplit_once('.')?;
    let ext = ext.to_ascii_lowercase();
    BOOK_EXT
        .iter()
        .find(|(e, _)| *e == ext)
        .map(|(_, format)| *format)
}

/// Hidden (`.x`) – includes AppleDouble (`._x`).
fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

/// Natural order: digit runs compare by value (`Band 2` < `Band 10`), the rest without case;
/// equal under that order → byte order (stable, total).
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (mut x, mut y) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (x.peek().copied(), y.peek().copied()) {
            (None, None) => return a.cmp(b),
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(c), Some(d)) if c.is_ascii_digit() && d.is_ascii_digit() => {
                let n = take_digits(&mut x);
                let m = take_digits(&mut y);
                let (n, m) = (n.trim_start_matches('0'), m.trim_start_matches('0'));
                let o = n.len().cmp(&m.len()).then_with(|| n.cmp(m));
                if o != Ordering::Equal {
                    return o;
                }
            }
            (Some(c), Some(d)) => {
                let o = c.to_lowercase().cmp(d.to_lowercase());
                if o != Ordering::Equal {
                    return o;
                }
                x.next();
                y.next();
            }
        }
    }
}

fn take_digits(it: &mut std::iter::Peekable<std::str::Chars<'_>>) -> String {
    let mut s = String::new();
    while let Some(c) = it.peek().copied().filter(char::is_ascii_digit) {
        s.push(c);
        it.next();
    }
    s
}

/// Scans `root` recursively for comic books.
pub fn scan(root: &Path) -> Result<LibraryScan, FsError> {
    scan_with_limit(root, MAX_BOOKS)
}

/// [`scan`] with an explicit upper bound (tests).
pub fn scan_with_limit(root: &Path, max_books: usize) -> Result<LibraryScan, FsError> {
    let meta = fs::metadata(root).map_err(|e| FsError::from_io(&e, root))?;
    if !meta.is_dir() {
        return Err(FsError::new(
            FsErrorCode::NotADirectory,
            "library root is not a folder",
            Some(root),
        ));
    }
    // the root itself must be readable – below it, unreadable folders are only counted
    let first = fs::read_dir(root).map_err(|e| FsError::from_io(&e, root))?;

    let mut out = LibraryScan {
        root: root.to_string_lossy().into_owned(),
        books: Vec::new(),
        unreadable_dirs: 0,
        skipped_entries: 0,
        truncated: false,
    };
    let mut pending: Vec<PathBuf> = Vec::new();
    let mut current = Some(first);

    'walk: loop {
        let entries = match current.take() {
            Some(rd) => rd,
            None => match pending.pop() {
                Some(dir) => match fs::read_dir(&dir) {
                    Ok(rd) => rd,
                    Err(_) => {
                        out.unreadable_dirs += 1;
                        continue;
                    }
                },
                None => break,
            },
        };
        for entry in entries {
            let Ok(entry) = entry else {
                out.skipped_entries += 1;
                continue;
            };
            let file_name = entry.file_name();
            let Some(name) = file_name.to_str() else {
                out.skipped_entries += 1;
                continue;
            };
            if is_hidden(name) {
                continue;
            }
            let Ok(ft) = entry.file_type() else {
                out.skipped_entries += 1;
                continue;
            };
            let path = entry.path();
            if ft.is_symlink() {
                out.skipped_entries += 1;
            } else if ft.is_dir() {
                pending.push(path);
            } else if ft.is_file() {
                let Some(format) = format_of(name) else {
                    continue;
                };
                if out.books.len() >= max_books {
                    out.truncated = true;
                    break 'walk;
                }
                let Some(rel_path) = rel_display(root, &path) else {
                    out.skipped_entries += 1;
                    continue;
                };
                let meta = entry.metadata().ok();
                out.books.push(BookEntry {
                    path: path.to_string_lossy().into_owned(),
                    rel_path,
                    name: name.to_owned(),
                    format,
                    size: meta.as_ref().map_or(0, |m| m.len()),
                    modified_ms: meta.and_then(|m| m.modified().ok()).and_then(|t| {
                        t.duration_since(UNIX_EPOCH)
                            .ok()
                            .and_then(|d| i64::try_from(d.as_millis()).ok())
                    }),
                });
            }
        }
    }
    out.books
        .sort_by(|a, b| natural_cmp(&a.rel_path, &b.rel_path));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{File, create_dir_all};

    fn touch(root: &Path, rel: &str) {
        let p = root.join(rel);
        create_dir_all(p.parent().unwrap()).unwrap();
        File::create(p).unwrap();
    }

    fn rels(scan: &LibraryScan) -> Vec<&str> {
        scan.books.iter().map(|b| b.rel_path.as_str()).collect()
    }

    #[test]
    fn format_by_extension_case_insensitive() {
        assert_eq!(format_of("a.CBZ"), Some(BookFormat::Cbz));
        assert_eq!(format_of("a.b.cbr"), Some(BookFormat::Cbr));
        assert_eq!(format_of("x.Pdf"), Some(BookFormat::Pdf));
        assert_eq!(format_of("x.cb7"), Some(BookFormat::Cb7));
        assert_eq!(format_of("x.cbt"), Some(BookFormat::Cbt));
        assert_eq!(format_of("cbz"), None);
        assert_eq!(format_of("x.jpg"), None);
        assert_eq!(format_of("x.zip"), None);
    }

    #[test]
    fn natural_order() {
        let mut v = vec!["Band 10.cbz", "band 2.cbz", "Band 1.cbz", "Band 02.cbz"];
        v.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(
            v,
            ["Band 1.cbz", "Band 02.cbz", "band 2.cbz", "Band 10.cbz"]
        );
    }

    #[test]
    fn finds_books_recursively_in_natural_order() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        touch(root, "Asterix/Asterix 10.cbr");
        touch(root, "Asterix/Asterix 2.cbz");
        touch(root, "Asterix/Asterix 2.jpg");
        touch(root, "Einzel.PDF");
        touch(root, "notes.txt");
        touch(root, "Tiefe/a/b/c/d/Tief.cb7");
        let scan = scan(root).unwrap();
        assert_eq!(
            rels(&scan),
            [
                "Asterix/Asterix 2.cbz",
                "Asterix/Asterix 10.cbr",
                "Einzel.PDF",
                "Tiefe/a/b/c/d/Tief.cb7"
            ]
        );
        assert_eq!(scan.books[2].format, BookFormat::Pdf);
        assert_eq!(scan.books[2].name, "Einzel.PDF");
        assert!(scan.books[0].modified_ms.is_some());
        assert!(!scan.truncated);
    }

    #[test]
    fn unicode_and_spaces() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "Hägar der Schreckliche/Hägar 01 🦸.cbz");
        let scan = scan(dir.path()).unwrap();
        assert_eq!(rels(&scan), ["Hägar der Schreckliche/Hägar 01 🦸.cbz"]);
    }

    #[test]
    fn skips_hidden_and_appledouble() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "._Band.cbz");
        touch(dir.path(), ".Panels/thumbnails/Band.cbz");
        touch(dir.path(), "Band.cbz");
        assert_eq!(rels(&scan(dir.path()).unwrap()), ["Band.cbz"]);
    }

    #[test]
    fn errors_for_unusable_root() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing");
        assert_eq!(scan(&missing).unwrap_err().code, FsErrorCode::NotFound);
        touch(dir.path(), "file.cbz");
        assert_eq!(
            scan(&dir.path().join("file.cbz")).unwrap_err().code,
            FsErrorCode::NotADirectory
        );
    }

    #[test]
    fn stops_at_limit() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..5 {
            touch(dir.path(), &format!("b{i}.cbz"));
        }
        let scan = scan_with_limit(dir.path(), 3).unwrap();
        assert_eq!(scan.books.len(), 3);
        assert!(scan.truncated);
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("lib");
        touch(&root, "a/Band.cbz");
        std::os::unix::fs::symlink(&root, root.join("loop")).unwrap();
        std::os::unix::fs::symlink(root.join("a/Band.cbz"), root.join("link.cbz")).unwrap();
        let scan = scan(&root).unwrap();
        assert_eq!(rels(&scan), ["a/Band.cbz"]);
        assert_eq!(scan.skipped_entries, 2);
    }

    #[cfg(unix)]
    #[test]
    fn counts_unreadable_folders() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "ok/Band.cbz");
        touch(dir.path(), "locked/Geheim.cbz");
        let locked = dir.path().join("locked");
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
        let readable_anyway = fs::read_dir(&locked).is_ok(); // root ignores permissions
        let scan = scan(dir.path()).unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        if !readable_anyway {
            assert_eq!(rels(&scan), ["ok/Band.cbz"]);
            assert_eq!(scan.unreadable_dirs, 1);
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn skips_non_utf8_names() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;
        let dir = tempfile::tempdir().unwrap();
        File::create(dir.path().join(OsStr::from_bytes(b"bad\xff.cbz"))).unwrap();
        touch(dir.path(), "good.cbz");
        let scan = scan(dir.path()).unwrap();
        assert_eq!(rels(&scan), ["good.cbz"]);
        assert_eq!(scan.skipped_entries, 1);
    }
}
