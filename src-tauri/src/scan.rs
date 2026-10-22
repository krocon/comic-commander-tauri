//! Scanning a category's `baseDir` for comic books (prompt 001, extended in design 002).
//!
//! Pure `std`, no Tauri – unit-tested with `tempfile`. Rules:
//! - recursive, iterative (no stack overflow on deep trees), cancellable between entries;
//! - a file counts when its name ends with one of the category's `bookExtensions`
//!   (case-insensitive – the old app compared exactly);
//! - symbolic links to **files** are followed, links to **folders** are not (no cycles, no
//!   escaping the `baseDir`) – counted in `skippedDirLinks`; broken links in `brokenLinks`
//!   (design 002 E2);
//! - hidden entries (`.name`) and macOS AppleDouble files (`._name`) are left out – the old
//!   sidecar thumbnails live in `.Panels/` and are found by the cover code, not the scan;
//! - names that are not valid UTF-8 are skipped (cannot round-trip through JSON);
//! - unreadable folders are counted, the scan goes on; only an unusable *root* is an error;
//! - at most [`MAX_BOOKS`] books, then `truncated`.

use crate::error::{FsError, FsErrorCode};
use crate::model::{BookEntry, BookFormat, ScanStats};
use crate::paths::rel_display;
use std::cmp::Ordering;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::time::{Duration, Instant, UNIX_EPOCH};

/// Upper bound of books per scan.
pub const MAX_BOOKS: usize = 500_000;

/// Extension → container kind (design 002 E3).
pub const FORMATS: &[(&str, BookFormat)] = &[
    (".cbz", BookFormat::Cbz),
    (".zip", BookFormat::Cbz),
    (".cbr", BookFormat::Cbr),
    (".rar", BookFormat::Cbr),
    (".cb7", BookFormat::Cb7),
    (".7z", BookFormat::Cb7),
    (".cbt", BookFormat::Cbt),
    (".tar", BookFormat::Cbt),
    (".pdf", BookFormat::Pdf),
];

/// The format of `name` if it ends with one of `extensions` (lower case, with dot).
pub fn match_extension(name: &str, extensions: &[String]) -> Option<BookFormat> {
    let lower = name.to_lowercase();
    let ext = extensions
        .iter()
        .find(|e| lower.len() > e.len() && lower.ends_with(e.as_str()))?;
    FORMATS.iter().find(|(e, _)| e == ext).map(|(_, f)| *f)
}

/// The id of a book: `fnv64(path)` as 16 hex digits (design 003 E1).
pub fn book_id(path: &str) -> String {
    format!("{:016x}", crate::categories::fnv64(path.as_bytes()))
}

/// Hidden (`.x`) – includes AppleDouble (`._x`).
fn is_hidden(name: &str) -> bool {
    name.starts_with('.')
}

/// Natural order: digit runs compare by value (`Band 2` < `Band 10`), the rest without case;
/// equal under that order → byte order (stable, total). Used for a deterministic cache –
/// the display order is the frontend's (`Intl.Collator`, design 002 E6).
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

pub fn sort_books(books: &mut [BookEntry]) {
    books.sort_by(|a, b| natural_cmp(&a.rel_path, &b.rel_path));
}

/// What the walk reports while it runs.
pub enum WalkEvent {
    Book(BookEntry),
    /// A folder was read completely (good moment for progress and batches).
    DirDone,
}

pub struct WalkOptions<'a> {
    /// Lower case, with dot (as [`crate::categories::normalize_extensions`] makes them).
    pub extensions: &'a [String],
    pub max_books: usize,
    /// Pause after every folder – only for tests of concurrent scans.
    pub dir_delay: Duration,
}

impl<'a> WalkOptions<'a> {
    pub fn new(extensions: &'a [String]) -> Self {
        Self {
            extensions,
            max_books: MAX_BOOKS,
            dir_delay: Duration::ZERO,
        }
    }
}

pub struct WalkOutcome {
    pub stats: ScanStats,
    pub cancelled: bool,
}

/// Walks `root`; every book goes to `on`. Errors only for an unusable root.
pub fn walk(
    root: &Path,
    opts: &WalkOptions<'_>,
    cancel: &AtomicBool,
    on: &mut dyn FnMut(WalkEvent, &ScanStats),
) -> Result<WalkOutcome, FsError> {
    let started = Instant::now();
    let meta = fs::metadata(root).map_err(|e| FsError::from_io(&e, root))?;
    if !meta.is_dir() {
        return Err(FsError::new(
            FsErrorCode::NotADirectory,
            "baseDir is not a folder",
            Some(root),
        ));
    }
    // the root itself must be readable – below it, unreadable folders are only counted
    let first = fs::read_dir(root).map_err(|e| FsError::from_io(&e, root))?;

    let mut stats = ScanStats::default();
    let mut pending: Vec<PathBuf> = Vec::new();
    let mut current = Some(first);
    let mut cancelled = false;

    'walk: loop {
        let entries = match current.take() {
            Some(rd) => rd,
            None => match pending.pop() {
                Some(dir) => match fs::read_dir(&dir) {
                    Ok(rd) => rd,
                    Err(_) => {
                        stats.unreadable_dirs += 1;
                        continue;
                    }
                },
                None => break,
            },
        };
        stats.dirs += 1;
        for entry in entries {
            if cancel.load(AtomicOrdering::Relaxed) {
                cancelled = true;
                break 'walk;
            }
            let Ok(entry) = entry else {
                stats.skipped_entries += 1;
                continue;
            };
            let file_name = entry.file_name();
            let Some(name) = file_name.to_str() else {
                stats.skipped_entries += 1;
                continue;
            };
            if is_hidden(name) {
                continue;
            }
            let Ok(ft) = entry.file_type() else {
                stats.skipped_entries += 1;
                continue;
            };
            let path = entry.path();
            let meta = if ft.is_symlink() {
                match fs::metadata(&path) {
                    Ok(m) if m.is_dir() => {
                        stats.skipped_dir_links += 1;
                        continue;
                    }
                    Ok(m) => m,
                    Err(_) => {
                        stats.broken_links += 1;
                        continue;
                    }
                }
            } else if ft.is_dir() {
                pending.push(path);
                continue;
            } else if ft.is_file() {
                if match_extension(name, opts.extensions).is_none() {
                    continue;
                }
                match entry.metadata() {
                    Ok(m) => m,
                    Err(_) => {
                        stats.skipped_entries += 1;
                        continue;
                    }
                }
            } else {
                continue;
            };
            if !meta.is_file() {
                continue;
            }
            let Some(format) = match_extension(name, opts.extensions) else {
                continue;
            };
            if stats.books as usize >= opts.max_books {
                stats.truncated = true;
                break 'walk;
            }
            let Some(rel_path) = rel_display(root, &path) else {
                stats.skipped_entries += 1;
                continue;
            };
            stats.books += 1;
            let path_text = path.to_string_lossy().into_owned();
            let book = BookEntry {
                id: book_id(&path_text),
                path: path_text,
                rel_path,
                name: name.to_owned(),
                format,
                size: meta.len(),
                modified_ms: meta.modified().ok().and_then(|t| {
                    t.duration_since(UNIX_EPOCH)
                        .ok()
                        .and_then(|d| i64::try_from(d.as_millis()).ok())
                }),
            };
            on(WalkEvent::Book(book), &stats);
        }
        on(WalkEvent::DirDone, &stats);
        if !opts.dir_delay.is_zero() {
            std::thread::sleep(opts.dir_delay);
        }
    }
    stats.duration_ms = started.elapsed().as_millis() as u64;
    Ok(WalkOutcome { stats, cancelled })
}

/// Walks `root` completely and returns the books in natural order.
pub fn scan(root: &Path, extensions: &[String]) -> Result<(Vec<BookEntry>, ScanStats), FsError> {
    let mut books = Vec::new();
    let outcome = walk(
        root,
        &WalkOptions::new(extensions),
        &AtomicBool::new(false),
        &mut |e, _| {
            if let WalkEvent::Book(b) = e {
                books.push(b);
            }
        },
    )?;
    sort_books(&mut books);
    Ok((books, outcome.stats))
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

    fn exts(list: &[&str]) -> Vec<String> {
        list.iter().map(|e| (*e).to_owned()).collect()
    }

    fn all() -> Vec<String> {
        exts(&[".cbz", ".cbr", ".cb7", ".cbt", ".pdf"])
    }

    fn rels(books: &[BookEntry]) -> Vec<&str> {
        books.iter().map(|b| b.rel_path.as_str()).collect()
    }

    #[test]
    fn matches_extensions_case_insensitive() {
        let e = all();
        assert_eq!(match_extension("a.CBZ", &e), Some(BookFormat::Cbz));
        assert_eq!(match_extension("a.b.cbr", &e), Some(BookFormat::Cbr));
        assert_eq!(match_extension("x.Pdf", &e), Some(BookFormat::Pdf));
        assert_eq!(match_extension("x.cb7", &e), Some(BookFormat::Cb7));
        assert_eq!(match_extension("x.cbt", &e), Some(BookFormat::Cbt));
        assert_eq!(match_extension(".cbz", &e), None);
        assert_eq!(match_extension("x.jpg", &e), None);
        assert_eq!(match_extension("x.zip", &e), None);
        assert_eq!(
            match_extension("x.ZIP", &exts(&[".zip"])),
            Some(BookFormat::Cbz)
        );
        assert_eq!(
            match_extension("x.rar", &exts(&[".rar"])),
            Some(BookFormat::Cbr)
        );
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
        let (books, stats) = scan(root, &all()).unwrap();
        assert_eq!(
            rels(&books),
            [
                "Asterix/Asterix 2.cbz",
                "Asterix/Asterix 10.cbr",
                "Einzel.PDF",
                "Tiefe/a/b/c/d/Tief.cb7"
            ]
        );
        assert_eq!(books[2].format, BookFormat::Pdf);
        assert_eq!(books[2].name, "Einzel.PDF");
        assert!(books[0].modified_ms.is_some());
        assert_eq!(stats.books, 4);
        assert_eq!(stats.dirs, 7);
        assert!(!stats.truncated);
    }

    #[test]
    fn only_the_extensions_of_the_category() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "Make 01.pdf");
        touch(dir.path(), "Comic.cbz");
        touch(dir.path(), "Heft.PDF");
        let (books, _) = scan(dir.path(), &exts(&[".pdf"])).unwrap();
        assert_eq!(rels(&books), ["Heft.PDF", "Make 01.pdf"]);
    }

    #[test]
    fn unicode_nfc_and_nfd() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "Hägar der Schreckliche/Hägar 01 🦸.cbz");
        // the same name in NFD (u + U+0308) – on Linux a second file
        touch(dir.path(), "Hu\u{308}gel.cbz");
        touch(dir.path(), "H\u{fc}gel 2.cbz");
        let (books, _) = scan(dir.path(), &all()).unwrap();
        assert_eq!(books.len(), 3);
        assert!(rels(&books).contains(&"Hu\u{308}gel.cbz"));
    }

    #[test]
    fn skips_hidden_and_appledouble() {
        let dir = tempfile::tempdir().unwrap();
        touch(dir.path(), "._Band.cbz");
        touch(dir.path(), ".Panels/thumbnails/Band.cbz");
        touch(dir.path(), "Band.cbz");
        assert_eq!(rels(&scan(dir.path(), &all()).unwrap().0), ["Band.cbz"]);
    }

    #[test]
    fn errors_for_unusable_root() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("missing");
        assert_eq!(
            scan(&missing, &all()).unwrap_err().code,
            FsErrorCode::NotFound
        );
        touch(dir.path(), "file.cbz");
        assert_eq!(
            scan(&dir.path().join("file.cbz"), &all()).unwrap_err().code,
            FsErrorCode::NotADirectory
        );
    }

    #[test]
    fn stops_at_limit() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..5 {
            touch(dir.path(), &format!("b{i}.cbz"));
        }
        let e = all();
        let opts = WalkOptions {
            max_books: 3,
            ..WalkOptions::new(&e)
        };
        let mut n = 0;
        let out = walk(dir.path(), &opts, &AtomicBool::new(false), &mut |e, _| {
            if matches!(e, WalkEvent::Book(_)) {
                n += 1;
            }
        })
        .unwrap();
        assert_eq!(n, 3);
        assert!(out.stats.truncated);
    }

    #[test]
    fn cancel_stops_the_walk() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..50 {
            touch(dir.path(), &format!("d{i}/b.cbz"));
        }
        let cancel = AtomicBool::new(false);
        let mut n = 0;
        let e = all();
        let out = walk(dir.path(), &WalkOptions::new(&e), &cancel, &mut |e, _| {
            if matches!(e, WalkEvent::Book(_)) {
                n += 1;
                if n == 5 {
                    cancel.store(true, AtomicOrdering::Relaxed);
                }
            }
        })
        .unwrap();
        assert!(out.cancelled);
        assert_eq!(n, 5);
    }

    #[cfg(unix)]
    #[test]
    fn follows_file_links_not_folder_links() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("lib");
        touch(&root, "a/Band.cbz");
        touch(dir.path(), "outside/Fremd.cbz");
        std::os::unix::fs::symlink(&root, root.join("loop")).unwrap();
        std::os::unix::fs::symlink(dir.path().join("outside"), root.join("ext")).unwrap();
        std::os::unix::fs::symlink(root.join("a/Band.cbz"), root.join("link.cbz")).unwrap();
        std::os::unix::fs::symlink(root.join("gone.cbz"), root.join("broken.cbz")).unwrap();
        let (books, stats) = scan(&root, &all()).unwrap();
        assert_eq!(rels(&books), ["a/Band.cbz", "link.cbz"]);
        assert_eq!(stats.skipped_dir_links, 2);
        assert_eq!(stats.broken_links, 1);
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
        let (books, stats) = scan(dir.path(), &all()).unwrap();
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
        if !readable_anyway {
            assert_eq!(rels(&books), ["ok/Band.cbz"]);
            assert_eq!(stats.unreadable_dirs, 1);
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
        let (books, stats) = scan(dir.path(), &all()).unwrap();
        assert_eq!(rels(&books), ["good.cbz"]);
        assert_eq!(stats.skipped_entries, 1);
    }
}
