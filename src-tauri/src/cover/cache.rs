//! Thumbnails on disk (design 003 E4): `<app cache>/covers/<xx>/<key>.jpg`, the key covers the
//! book (path, size, modification time) and the size of the thumbnail – a changed book gets new
//! thumbnails by itself. Bounded: oldest first (modification time; a served file is "touched"
//! at most once a day → a coarse LRU). Never in the comic folders.

use crate::categories::fnv64;
use crate::fs_atomic::write_atomic;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, SystemTime};

/// Default upper bound of the cache (setting in prompt 009).
pub const DEFAULT_LIMIT: u64 = 2 << 30;
/// After this many new thumbnails the cache is trimmed.
pub const TRIM_EVERY: usize = 500;
/// Served files are touched when older than this.
const TOUCH_AFTER: Duration = Duration::from_secs(24 * 3600);
pub const DIR_NAME: &str = "covers";

pub struct CoverCache {
    dir: PathBuf,
    limit: u64,
    written: AtomicUsize,
}

/// The cache key of a thumbnail.
pub fn key(path: &Path, size: u64, modified_ms: i64, width: u32, height: u32) -> String {
    let mut bytes = path.to_string_lossy().into_owned().into_bytes();
    bytes.push(0);
    bytes.extend_from_slice(format!("{size}\0{modified_ms}\0{width}x{height}").as_bytes());
    format!("{:016x}", fnv64(&bytes))
}

impl CoverCache {
    pub fn new(cache_dir: &Path, limit: u64) -> Self {
        Self {
            dir: cache_dir.join(DIR_NAME),
            limit,
            written: AtomicUsize::new(0),
        }
    }

    fn file(&self, key: &str) -> PathBuf {
        self.dir.join(&key[..2]).join(format!("{key}.jpg"))
    }

    /// A thumbnail exists (without reading it).
    pub fn contains(&self, key: &str) -> bool {
        self.file(key).is_file()
    }

    pub fn get(&self, key: &str) -> Option<Vec<u8>> {
        let file = self.file(key);
        let data = fs::read(&file).ok()?;
        let old = fs::metadata(&file)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.elapsed().ok())
            .is_some_and(|age| age > TOUCH_AFTER);
        if old && let Ok(f) = fs::File::options().write(true).open(&file) {
            let _ = f.set_modified(SystemTime::now());
        }
        Some(data)
    }

    pub fn put(&self, key: &str, data: &[u8]) -> io::Result<()> {
        write_atomic(&self.file(key), data)?;
        if self.written.fetch_add(1, Ordering::Relaxed) % TRIM_EVERY == TRIM_EVERY - 1 {
            self.trim();
        }
        Ok(())
    }

    /// Deletes the oldest thumbnails until the cache is below 90 % of its limit.
    /// Returns (files removed, bytes left).
    pub fn trim(&self) -> (usize, u64) {
        let mut files: Vec<(SystemTime, u64, PathBuf)> = Vec::new();
        for sub in fs::read_dir(&self.dir).into_iter().flatten().flatten() {
            for f in fs::read_dir(sub.path()).into_iter().flatten().flatten() {
                if let Ok(m) = f.metadata()
                    && m.is_file()
                {
                    files.push((
                        m.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                        m.len(),
                        f.path(),
                    ));
                }
            }
        }
        let mut total: u64 = files.iter().map(|f| f.1).sum();
        if total <= self.limit {
            return (0, total);
        }
        files.sort_by_key(|f| f.0);
        let target = self.limit / 10 * 9;
        let mut removed = 0;
        for (_, len, path) in files {
            if total <= target {
                break;
            }
            if fs::remove_file(&path).is_ok() {
                total -= len;
                removed += 1;
            }
        }
        (removed, total)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_changes_with_book_and_size() {
        let p = Path::new("/c/Hägar 01.cbz");
        let k = key(p, 10, 1, 200, 300);
        assert_eq!(k.len(), 16);
        assert_eq!(k, key(p, 10, 1, 200, 300));
        assert_ne!(k, key(p, 11, 1, 200, 300));
        assert_ne!(k, key(p, 10, 2, 200, 300));
        assert_ne!(k, key(p, 10, 1, 800, 1200));
        assert_ne!(k, key(Path::new("/c/other.cbz"), 10, 1, 200, 300));
    }

    #[test]
    fn put_get_and_trim_oldest_first() {
        let d = tempfile::tempdir().unwrap();
        let c = CoverCache::new(d.path(), 2500);
        for i in 0..5u32 {
            let k = key(Path::new("/b"), 1, i64::from(i), 1, 1);
            c.put(&k, &[i as u8; 1000]).unwrap();
            let f = c.file(&k);
            let t = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000 + u64::from(i));
            fs::File::options()
                .write(true)
                .open(f)
                .unwrap()
                .set_modified(t)
                .unwrap();
        }
        assert_eq!(
            c.get(&key(Path::new("/b"), 1, 4, 1, 1)).unwrap(),
            vec![4u8; 1000]
        );
        let (removed, left) = c.trim();
        assert_eq!((removed, left), (3, 2000));
        // the newest stay (4 was touched by `get`)
        assert!(c.get(&key(Path::new("/b"), 1, 0, 1, 1)).is_none());
        assert!(c.get(&key(Path::new("/b"), 1, 3, 1, 1)).is_some());
        assert!(c.get(&key(Path::new("/b"), 1, 4, 1, 1)).is_some());
        assert_eq!(c.trim(), (0, 2000));
    }
}
