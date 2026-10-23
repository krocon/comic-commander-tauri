//! Unpacked pages on disk (design 005 E1): `<app cache>/pages/<key>/<00000>.img` for books that
//! can only be read in order (7z, solid RAR). The key covers path, size and modification time –
//! a changed book is unpacked again. `complete.json` marks a book unpacked to the end (with the
//! page sizes); without it the folder is rebuilt. Bounded: whole books, the longest unread
//! first, never one that is open (legacy §10.4: the old app never cleaned up).

use crate::categories::fnv64;
use crate::fs_atomic::write_atomic;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

pub const DIR_NAME: &str = "pages";
/// Default bound of the page cache (setting in prompt 009).
pub const DEFAULT_LIMIT: u64 = 1 << 30;
const COMPLETE: &str = "complete.json";

/// What `complete.json` holds: per page its size, or `None` (failed / no size).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Complete {
    pub pages: Vec<Option<(u32, u32)>>,
    /// Pages that could not be unpacked (error code in snake_case).
    #[serde(default)]
    pub failed: Vec<(usize, String)>,
}

pub struct PageCache {
    dir: PathBuf,
    limit: u64,
}

/// The cache key of a book.
pub fn key(path: &Path, size: u64, modified_ms: i64) -> String {
    let mut bytes = path.to_string_lossy().into_owned().into_bytes();
    bytes.push(0);
    bytes.extend_from_slice(format!("{size}\0{modified_ms}\0pages").as_bytes());
    format!("{:016x}", fnv64(&bytes))
}

fn dir_size(dir: &Path) -> u64 {
    fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|f| f.metadata().ok())
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .sum()
}

impl PageCache {
    pub fn new(cache_dir: &Path, limit: u64) -> Self {
        Self {
            dir: cache_dir.join(DIR_NAME),
            limit,
        }
    }

    pub fn limit(&self) -> u64 {
        self.limit
    }

    pub fn book_dir(&self, key: &str) -> PathBuf {
        self.dir.join(key)
    }

    pub fn page_file(&self, key: &str, index: usize) -> PathBuf {
        self.book_dir(key).join(format!("{index:05}.img"))
    }

    /// The marker of a book unpacked to the end; it is "touched" (most recently read).
    pub fn complete(&self, key: &str) -> Option<Complete> {
        let file = self.book_dir(key).join(COMPLETE);
        let c: Complete = serde_json::from_slice(&fs::read(&file).ok()?).ok()?;
        if let Ok(f) = fs::File::options().write(true).open(&file) {
            let _ = f.set_modified(SystemTime::now());
        }
        Some(c)
    }

    pub fn mark_complete(&self, key: &str, complete: &Complete) -> io::Result<()> {
        let json = serde_json::to_vec(complete).map_err(io::Error::other)?;
        write_atomic(&self.book_dir(key).join(COMPLETE), &json)
    }

    /// An empty folder for unpacking `key` (a half-done one is removed first).
    pub fn reset(&self, key: &str) -> io::Result<()> {
        let dir = self.book_dir(key);
        match fs::remove_dir_all(&dir) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(e),
            _ => {}
        }
        fs::create_dir_all(&dir)
    }

    pub fn write_page(&self, key: &str, index: usize, data: &[u8]) -> io::Result<()> {
        write_atomic(&self.page_file(key, index), data)
    }

    /// Removes the longest unread books until the cache is below 90 % of its limit; books in
    /// `keep` (open ones) stay. Returns (books removed, bytes left).
    pub fn trim(&self, keep: &HashSet<String>) -> (usize, u64) {
        let mut books: Vec<(SystemTime, u64, PathBuf, bool)> = Vec::new();
        for d in fs::read_dir(&self.dir).into_iter().flatten().flatten() {
            let path = d.path();
            if !path.is_dir() {
                continue;
            }
            let name = d.file_name().to_string_lossy().into_owned();
            // the marker's time (touched when read), else the folder's
            let time = fs::metadata(path.join(COMPLETE))
                .or_else(|_| fs::metadata(&path))
                .and_then(|m| m.modified())
                .unwrap_or(SystemTime::UNIX_EPOCH);
            books.push((time, dir_size(&path), path, keep.contains(&name)));
        }
        let mut total: u64 = books.iter().map(|b| b.1).sum();
        if total <= self.limit {
            return (0, total);
        }
        books.sort_by_key(|b| b.0);
        let target = self.limit / 10 * 9;
        let mut removed = 0;
        for (_, size, path, kept) in books {
            if total <= target {
                break;
            }
            if !kept && fs::remove_dir_all(&path).is_ok() {
                total -= size;
                removed += 1;
            }
        }
        (removed, total)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn key_changes_with_the_book() {
        let p = Path::new("/c/Hägar 01 🦸.cb7");
        let k = key(p, 10, 1);
        assert_eq!(k.len(), 16);
        assert_eq!(k, key(p, 10, 1));
        assert_ne!(k, key(p, 11, 1));
        assert_ne!(k, key(p, 10, 2));
        assert_ne!(k, key(Path::new("/c/other.cb7"), 10, 1));
    }

    #[test]
    fn complete_marker_round_trip_and_reset() {
        let d = tempfile::tempdir().unwrap();
        let c = PageCache::new(d.path(), DEFAULT_LIMIT);
        c.reset("k").unwrap();
        c.write_page("k", 3, b"abc").unwrap();
        assert_eq!(fs::read(c.page_file("k", 3)).unwrap(), b"abc");
        assert!(c.complete("k").is_none());
        let m = Complete {
            pages: vec![Some((10, 20)), None],
            failed: vec![(1, "archive_too_large".into())],
        };
        c.mark_complete("k", &m).unwrap();
        assert_eq!(c.complete("k"), Some(m));
        c.reset("k").unwrap();
        assert!(c.complete("k").is_none());
        assert!(!c.page_file("k", 3).exists());
    }

    #[test]
    fn twenty_books_stay_bounded_open_ones_kept() {
        let d = tempfile::tempdir().unwrap();
        let c = PageCache::new(d.path(), 10_000);
        for i in 0..20u64 {
            let k = format!("book{i:02}");
            c.reset(&k).unwrap();
            c.write_page(&k, 0, &[0u8; 1000]).unwrap();
            c.mark_complete(
                &k,
                &Complete {
                    pages: vec![None],
                    failed: vec![],
                },
            )
            .unwrap();
            let t = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000 + i);
            fs::File::options()
                .write(true)
                .open(c.book_dir(&k).join(COMPLETE))
                .unwrap()
                .set_modified(t)
                .unwrap();
        }
        // the oldest one is open: it stays
        let keep: HashSet<String> = ["book00".to_string()].into();
        let (removed, left) = c.trim(&keep);
        assert!(left <= 9_000, "{left}");
        assert!(removed >= 10);
        assert!(c.book_dir("book00").exists());
        assert!(!c.book_dir("book01").exists());
        assert!(c.book_dir("book19").exists());
        assert_eq!(c.trim(&keep).0, 0);
    }
}
