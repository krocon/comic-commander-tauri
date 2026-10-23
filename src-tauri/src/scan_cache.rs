//! The scan cache (design 002 E5): one JSON file per scanned target in the app cache folder
//! (`<cache>/scans/<key>.json`), never in the comic folder. The key is *what* is scanned –
//! `baseDir` plus the sorted extensions – not the category id.
//!
//! Pure – no Tauri. A broken file is moved aside (`.bad`), a cache of another version or
//! another target counts as missing.

use crate::categories::fnv64;
use crate::config_file;
use crate::fs_atomic::write_atomic;
use crate::model::{BookEntry, ScanStats};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// 2: `BookEntry.id` (design 003); 3: `BookEntry.meta` (design 011) – older caches count as
/// missing (one new walk, then the ComicInfo pass).
pub const VERSION: u32 = 3;
/// Largest cache file read (≈ 1 million books).
pub const MAX_BYTES: u64 = 256 << 20;
pub const DIR_NAME: &str = "scans";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanCache {
    pub version: u32,
    pub base_dir: String,
    /// Sorted.
    pub book_extensions: Vec<String>,
    pub scanned_at: i64,
    /// Natural order (`scan::sort_books`).
    pub books: Vec<BookEntry>,
    pub stats: ScanStats,
}

fn sorted(extensions: &[String]) -> Vec<String> {
    let mut e = extensions.to_vec();
    e.sort();
    e.dedup();
    e
}

/// `fnv64(baseDir \0 ext1 \0 ext2 …)` as 16 hex digits.
pub fn cache_key(base_dir: &str, extensions: &[String]) -> String {
    let mut bytes = base_dir.as_bytes().to_vec();
    for e in sorted(extensions) {
        bytes.push(0);
        bytes.extend_from_slice(e.as_bytes());
    }
    format!("{:016x}", fnv64(&bytes))
}

pub fn cache_file(cache_dir: &Path, key: &str) -> PathBuf {
    cache_dir.join(DIR_NAME).join(format!("{key}.json"))
}

/// The cache of this target, if there is a valid one.
pub fn read(cache_dir: &Path, base_dir: &str, extensions: &[String]) -> Option<ScanCache> {
    let file = cache_file(cache_dir, &cache_key(base_dir, extensions));
    if !file.exists() {
        return None;
    }
    let exts = sorted(extensions);
    let loaded = config_file::read_config(
        &file,
        MAX_BYTES,
        || None,
        |text| {
            let c: ScanCache = serde_json::from_str(text).map_err(|e| e.to_string())?;
            Ok(
                (c.version == VERSION && c.base_dir == base_dir && c.book_extensions == exts)
                    .then_some(c),
            )
        },
    );
    loaded.value
}

/// Writes the cache atomically (compact JSON).
pub fn write(cache_dir: &Path, cache: &ScanCache) -> io::Result<()> {
    let file = cache_file(
        cache_dir,
        &cache_key(&cache.base_dir, &cache.book_extensions),
    );
    let json = serde_json::to_vec(cache).map_err(io::Error::other)?;
    write_atomic(&file, &json)
}

/// Removes cache files (also `.bad`) whose key is not in `keep`. Returns how many.
pub fn cleanup(cache_dir: &Path, keep: &HashSet<String>) -> usize {
    let Ok(entries) = fs::read_dir(cache_dir.join(DIR_NAME)) else {
        return 0;
    };
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let key = name.split('.').next().unwrap_or_default();
        if key.len() == 16 && !keep.contains(key) && fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diff {
    pub added: Vec<BookEntry>,
    /// Paths.
    pub removed: Vec<String>,
    /// Same path, other size or modification time.
    pub changed: Vec<BookEntry>,
}

impl Diff {
    pub fn is_empty(&self) -> bool {
        self.added.is_empty() && self.removed.is_empty() && self.changed.is_empty()
    }
}

pub fn diff(old: &[BookEntry], new: &[BookEntry]) -> Diff {
    let before: HashMap<&str, &BookEntry> = old.iter().map(|b| (b.path.as_str(), b)).collect();
    let after: HashSet<&str> = new.iter().map(|b| b.path.as_str()).collect();
    let mut d = Diff::default();
    for b in new {
        match before.get(b.path.as_str()) {
            None => d.added.push(b.clone()),
            Some(o)
                if o.size != b.size || o.modified_ms != b.modified_ms || o.format != b.format =>
            {
                d.changed.push(b.clone())
            }
            Some(_) => {}
        }
    }
    d.removed = old
        .iter()
        .filter(|b| !after.contains(b.path.as_str()))
        .map(|b| b.path.clone())
        .collect();
    d
}

/// Copies the metadata of the old scan to the new one where the book is the same file (path,
/// size, modification time and format – what `diff` calls unchanged; design 011 E3).
pub fn carry_meta(old: &[BookEntry], new: &mut [BookEntry]) {
    let before: HashMap<&str, &BookEntry> = old
        .iter()
        .filter(|b| b.meta.is_some())
        .map(|b| (b.path.as_str(), b))
        .collect();
    for b in new.iter_mut() {
        if let Some(o) = before.get(b.path.as_str())
            && o.size == b.size
            && o.modified_ms == b.modified_ms
            && o.format == b.format
        {
            b.meta.clone_from(&o.meta);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::BookFormat;

    fn book(p: &str, size: u64) -> BookEntry {
        BookEntry {
            id: crate::scan::book_id(&format!("/lib/{p}")),
            path: format!("/lib/{p}"),
            rel_path: p.into(),
            name: p.into(),
            format: BookFormat::Cbz,
            size,
            modified_ms: Some(1),
            meta: None,
        }
    }

    fn exts(l: &[&str]) -> Vec<String> {
        l.iter().map(|e| (*e).to_owned()).collect()
    }

    fn cache(base: &str, e: &[&str]) -> ScanCache {
        ScanCache {
            version: VERSION,
            base_dir: base.into(),
            book_extensions: sorted(&exts(e)),
            scanned_at: 42,
            books: vec![book("a.cbz", 1), book("Hägar 🦸.cbz", 2)],
            stats: ScanStats::default(),
        }
    }

    #[test]
    fn key_depends_on_dir_and_extension_set() {
        let a = cache_key("/c", &exts(&[".cbz", ".cbr"]));
        assert_eq!(a, cache_key("/c", &exts(&[".cbr", ".cbz"])));
        assert_ne!(a, cache_key("/c", &exts(&[".cbz"])));
        assert_ne!(a, cache_key("/d", &exts(&[".cbz", ".cbr"])));
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn round_trip_and_mismatch() {
        let dir = tempfile::tempdir().unwrap();
        let c = cache("/c/ö", &[".cbz", ".cbr"]);
        write(dir.path(), &c).unwrap();
        assert_eq!(read(dir.path(), "/c/ö", &exts(&[".cbr", ".cbz"])), Some(c));
        assert_eq!(read(dir.path(), "/c/ö", &exts(&[".cbz"])), None);
        assert_eq!(read(dir.path(), "/other", &exts(&[".cbz", ".cbr"])), None);
    }

    #[test]
    fn other_version_and_broken_files_count_as_missing() {
        let dir = tempfile::tempdir().unwrap();
        let mut c = cache("/c", &[".cbz"]);
        c.version = 99;
        write(dir.path(), &c).unwrap();
        assert_eq!(read(dir.path(), "/c", &exts(&[".cbz"])), None);
        let file = cache_file(dir.path(), &cache_key("/c", &exts(&[".cbz"])));
        fs::write(&file, "{ nope").unwrap();
        assert_eq!(read(dir.path(), "/c", &exts(&[".cbz"])), None);
        assert!(!file.exists(), "broken cache moved aside");
    }

    #[test]
    fn cleanup_keeps_only_listed_keys() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), &cache("/a", &[".cbz"])).unwrap();
        write(dir.path(), &cache("/b", &[".cbz"])).unwrap();
        let keep: HashSet<String> = [cache_key("/a", &exts(&[".cbz"]))].into();
        assert_eq!(cleanup(dir.path(), &keep), 1);
        assert!(read(dir.path(), "/a", &exts(&[".cbz"])).is_some());
        assert!(read(dir.path(), "/b", &exts(&[".cbz"])).is_none());
        assert_eq!(cleanup(&dir.path().join("none"), &keep), 0);
    }

    #[test]
    fn diff_finds_added_removed_changed() {
        let old = vec![book("a", 1), book("b", 1), book("c", 1)];
        let mut c2 = book("c", 1);
        c2.modified_ms = Some(2);
        let new = vec![book("a", 1), book("b", 5), c2, book("d", 1)];
        let d = diff(&old, &new);
        assert_eq!(d.added, vec![book("d", 1)]);
        assert!(d.removed.is_empty());
        assert_eq!(d.changed.len(), 2);
        let d = diff(&new, &old[..1]);
        assert_eq!(d.removed, ["/lib/b", "/lib/c", "/lib/d"]);
        assert!(diff(&old, &old).is_empty());
    }

    #[test]
    fn meta_is_carried_over_for_unchanged_books_only() {
        use crate::comic_info::BookMeta;
        let meta = |s: &str| {
            Some(BookMeta {
                series: Some(s.into()),
                ..Default::default()
            })
        };
        let mut a = book("a", 1);
        a.meta = meta("A");
        let mut b = book("b", 1);
        b.meta = meta("B");
        let mut c = book("c", 1);
        c.meta = Some(BookMeta::default());
        let old = vec![a, b, c, book("d", 1)];
        let mut new = vec![book("a", 1), book("b", 2), book("c", 1), book("d", 1), book("e", 1)];
        carry_meta(&old, &mut new);
        assert_eq!(new[0].meta, meta("A"));
        assert_eq!(new[1].meta, None, "changed size: read again");
        assert_eq!(new[2].meta, Some(BookMeta::default()), "read, nothing found: kept");
        assert_eq!(new[3].meta, None);
        assert_eq!(new[4].meta, None);
        // the metadata does not make a diff
        assert!(diff(&old, &new[..4]).changed.len() == 1);
    }

    #[test]
    fn meta_round_trips_and_old_entries_without_it_load() {
        let dir = tempfile::tempdir().unwrap();
        let mut c = cache("/c", &[".cbz"]);
        c.books[0].meta = Some(crate::comic_info::BookMeta {
            series: Some("Hägar".into()),
            year: Some(1973),
            ..Default::default()
        });
        write(dir.path(), &c).unwrap();
        let back = read(dir.path(), "/c", &exts(&[".cbz"])).unwrap();
        assert_eq!(back, c);
        assert_eq!(back.books[1].meta, None);
        // version 2 (before design 011) counts as missing
        let mut old = cache("/c", &[".cbz"]);
        old.version = 2;
        write(dir.path(), &old).unwrap();
        assert_eq!(read(dir.path(), "/c", &exts(&[".cbz"])), None);
    }
}
