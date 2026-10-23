//! Which books the scan listed, per category (design 003 E1): `book id → path`. Filled from the
//! events of `open_category`; the cover scheme only serves books found here – the WebView never
//! names a file.

use crate::scan::book_id;
use crate::scan_hub::ScanEvent;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Default)]
pub struct BookRegistry {
    map: Mutex<HashMap<String, HashMap<String, PathBuf>>>,
}

impl BookRegistry {
    pub fn apply(&self, category_id: &str, event: &ScanEvent) {
        let mut map = self.map.lock().unwrap_or_else(|e| e.into_inner());
        let books = map.entry(category_id.to_owned()).or_default();
        fn add(books: &mut HashMap<String, PathBuf>, list: &[crate::model::BookEntry]) {
            for b in list {
                books.insert(b.id.clone(), PathBuf::from(&b.path));
            }
        }
        match event {
            ScanEvent::Cached { books: list, .. } => {
                books.clear();
                add(books, list);
            }
            ScanEvent::Started { first_scan: true } => books.clear(),
            ScanEvent::Batch { books: list } | ScanEvent::CachedMore { books: list, .. } => {
                add(books, list)
            }
            ScanEvent::Diff {
                added,
                removed,
                changed,
            } => {
                add(books, added);
                add(books, changed);
                for path in removed {
                    books.remove(&book_id(path));
                }
            }
            _ => {}
        }
    }

    pub fn path(&self, category_id: &str, book_id: &str) -> Option<PathBuf> {
        self.map
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(category_id)?
            .get(book_id)
            .cloned()
    }

    /// Forgets a category (removed or its folder/types changed).
    pub fn forget(&self, category_id: &str) {
        self.map
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(category_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{BookEntry, BookFormat, ScanStats};

    fn book(p: &str) -> BookEntry {
        BookEntry {
            id: book_id(p),
            path: p.into(),
            rel_path: p.into(),
            name: p.into(),
            format: BookFormat::Cbz,
            size: 1,
            modified_ms: None,
            meta: None,
        }
    }

    #[test]
    fn follows_the_scan_events() {
        let r = BookRegistry::default();
        let a = book("/c/a.cbz");
        let b = book("/c/b.cbz");
        r.apply(
            "c1",
            &ScanEvent::Cached {
                books: vec![a.clone()],
                scanned_at: 0,
                stats: ScanStats::default(),
                complete: true,
            },
        );
        assert_eq!(r.path("c1", &a.id), Some(PathBuf::from("/c/a.cbz")));
        assert_eq!(r.path("c2", &a.id), None, "per category");
        let more = book("/c/more.cbz");
        r.apply(
            "c1",
            &ScanEvent::CachedMore {
                books: vec![more.clone()],
                complete: true,
            },
        );
        assert_eq!(r.path("c1", &more.id), Some(PathBuf::from("/c/more.cbz")));
        r.apply(
            "c1",
            &ScanEvent::Diff {
                added: vec![b.clone()],
                removed: vec![a.path.clone()],
                changed: vec![],
            },
        );
        assert_eq!(r.path("c1", &a.id), None);
        assert!(r.path("c1", &b.id).is_some());
        r.apply("c1", &ScanEvent::Started { first_scan: true });
        assert_eq!(r.path("c1", &b.id), None);
        r.apply(
            "c1",
            &ScanEvent::Batch {
                books: vec![a.clone()],
            },
        );
        assert!(r.path("c1", &a.id).is_some());
        r.forget("c1");
        assert_eq!(r.path("c1", &a.id), None);
    }
}
