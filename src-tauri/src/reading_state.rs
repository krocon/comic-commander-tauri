//! Reading positions (design 005 E5): the last page per book in `<app config>/reading-state.json`
//! – never in the comic folders. Keyed by the book id of the scan (`fnv64(path)`); at most
//! [`MAX_BOOKS`] books, the longest unread go first. Loaded with the shared config loader
//! (missing → empty, broken → kept as `.bad`), written atomically.

use crate::config_file::read_config;
use crate::error::{FsError, FsErrorCode};
use crate::fs_atomic::write_atomic;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

pub const FILE_NAME: &str = "reading-state.json";
pub const VERSION: u32 = 1;
/// Books remembered at most.
pub const MAX_BOOKS: usize = 5000;
/// Largest file read (5 000 books ≈ 400 KB).
const MAX_FILE: u64 = 4 << 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingPosition {
    /// Last page shown (0-based).
    pub page: usize,
    /// Pages of the book then.
    pub pages: usize,
    pub updated_ms: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ReadingState {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub books: HashMap<String, ReadingPosition>,
}

/// A book id from the scan: 16 lowercase hex digits.
pub fn valid_book_id(id: &str) -> bool {
    id.len() == 16
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

impl ReadingState {
    /// Loads the file of `config_dir` (lenient: bad entries are dropped).
    pub fn load(config_dir: &Path) -> ReadingState {
        let loaded = read_config(
            &config_dir.join(FILE_NAME),
            MAX_FILE,
            ReadingState::default,
            |text| serde_json::from_str::<ReadingState>(text).map_err(|e| e.to_string()),
        );
        let mut state = loaded.value;
        state
            .books
            .retain(|id, p| valid_book_id(id) && p.pages > 0 && p.page < p.pages);
        state.prune();
        state
    }

    pub fn save(&self, config_dir: &Path) -> Result<(), FsError> {
        let file = config_dir.join(FILE_NAME);
        let json = serde_json::to_vec(&ReadingState {
            version: VERSION,
            books: self.books.clone(),
        })
        .map_err(|e| FsError::new(FsErrorCode::Io, e.to_string(), None))?;
        write_atomic(&file, &json).map_err(|e| FsError::from_io(&e, &file))
    }

    /// Remembers `page` of `pages`; returns `false` (nothing changed) for nonsense.
    pub fn set(&mut self, book_id: &str, page: usize, pages: usize, now_ms: i64) -> bool {
        if !valid_book_id(book_id) || pages == 0 || page >= pages {
            return false;
        }
        self.books.insert(
            book_id.to_owned(),
            ReadingPosition {
                page,
                pages,
                updated_ms: now_ms,
            },
        );
        self.prune();
        true
    }

    /// At most [`MAX_BOOKS`]: the oldest go.
    fn prune(&mut self) {
        if self.books.len() <= MAX_BOOKS {
            return;
        }
        let mut by_age: Vec<(i64, String)> = self
            .books
            .iter()
            .map(|(id, p)| (p.updated_ms, id.clone()))
            .collect();
        by_age.sort();
        let excess = self.books.len() - MAX_BOOKS;
        for (_, id) in by_age.into_iter().take(excess) {
            self.books.remove(&id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "0123456789abcdef";
    const B: &str = "fedcba9876543210";

    #[test]
    fn set_save_load_round_trip() {
        let d = tempfile::tempdir().unwrap();
        // the config folder may not exist yet
        let dir = d.path().join("Comic Commander ä 🦸");
        let mut s = ReadingState::load(&dir);
        assert!(s.books.is_empty());
        assert!(s.set(A, 11, 48, 1000));
        assert!(s.set(B, 0, 3, 2000));
        s.save(&dir).unwrap();
        let back = ReadingState::load(&dir);
        assert_eq!(back.books.len(), 2);
        assert_eq!(
            back.books[A],
            ReadingPosition {
                page: 11,
                pages: 48,
                updated_ms: 1000
            }
        );
        let raw = std::fs::read_to_string(dir.join(FILE_NAME)).unwrap();
        assert!(raw.contains("\"version\":1"));
        assert!(raw.contains("\"updatedMs\""));
    }

    #[test]
    fn nonsense_is_refused() {
        let mut s = ReadingState::default();
        assert!(!s.set("../../etc", 1, 2, 0));
        assert!(!s.set("0123456789ABCDEF", 1, 2, 0));
        assert!(!s.set(A, 2, 2, 0));
        assert!(!s.set(A, 0, 0, 0));
        assert!(s.books.is_empty());
    }

    #[test]
    fn bounded_oldest_first() {
        let mut s = ReadingState::default();
        for i in 0..(MAX_BOOKS + 10) {
            assert!(s.set(&format!("{i:016x}"), 0, 1, i as i64));
        }
        assert_eq!(s.books.len(), MAX_BOOKS);
        assert!(!s.books.contains_key(&format!("{:016x}", 9)));
        assert!(s.books.contains_key(&format!("{:016x}", 10)));
    }

    #[test]
    fn broken_or_hostile_file_gives_empty_or_cleaned_state() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join(FILE_NAME), b"{ broken").unwrap();
        assert!(ReadingState::load(d.path()).books.is_empty());
        assert!(d.path().join(format!("{FILE_NAME}.bad")).exists());
        std::fs::write(
            d.path().join(FILE_NAME),
            format!(
                r#"{{"version":1,"books":{{"{A}":{{"page":5,"pages":3,"updatedMs":1}},"x":{{"page":0,"pages":3,"updatedMs":1}},"{B}":{{"page":1,"pages":3,"updatedMs":1}}}}}}"#
            ),
        )
        .unwrap();
        let s = ReadingState::load(d.path());
        assert_eq!(s.books.keys().collect::<Vec<_>>(), [B]);
    }
}
