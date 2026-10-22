//! Books outside the app (design 004 E5): "open with the default app". The frontend names a
//! book only by category id + book id; the path comes from the [`BookRegistry`] – a book the
//! scan did not list cannot be opened. The check is pure and tested; opening goes through the
//! `open` crate (argument array, no shell).
//!
//! Übernommen aus files-and-folders-tauri `opener.rs` (Design 003 E2), gekürzt: Bücher haben die
//! Endungen ihrer Kategorie, der Test auf ausführbare Dateien entfällt.

use crate::book_registry::BookRegistry;
use crate::error::{FsError, FsErrorCode};
use std::path::{Path, PathBuf};

/// The path of a listed book that still is a regular file.
pub fn resolve_book(
    registry: &BookRegistry,
    category_id: &str,
    book_id: &str,
) -> Result<PathBuf, FsError> {
    let path = registry.path(category_id, book_id).ok_or_else(|| {
        FsError::new(
            FsErrorCode::UnknownBook,
            "the book is not in the scanned list",
            None,
        )
    })?;
    let meta = std::fs::metadata(&path).map_err(|e| FsError::from_io(&e, &path))?;
    if !meta.is_file() {
        return Err(FsError::new(
            FsErrorCode::NotFound,
            "the book is no file any more",
            Some(&path),
        ));
    }
    Ok(path)
}

/// Opens with the system's default application, detached from this process.
pub fn open_with_default_app(path: &Path) -> Result<(), FsError> {
    open::that_detached(path).map_err(|e| FsError::from_io(&e, path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{BookEntry, BookFormat, ScanStats};
    use crate::scan::book_id;
    use crate::scan_hub::ScanEvent;

    fn registry_with(path: &Path) -> BookRegistry {
        let registry = BookRegistry::default();
        let p = path.to_string_lossy().into_owned();
        registry.apply(
            "c1",
            &ScanEvent::Cached {
                books: vec![BookEntry {
                    id: book_id(&p),
                    path: p,
                    rel_path: "x.cbz".into(),
                    name: "x.cbz".into(),
                    format: BookFormat::Cbz,
                    size: 1,
                    modified_ms: None,
                }],
                scanned_at: 0,
                stats: ScanStats::default(),
                complete: true,
            },
        );
        registry
    }

    #[test]
    fn only_listed_existing_files_resolve() {
        let d = tempfile::tempdir().unwrap();
        let f = d.path().join("Hägar 🦸.cbz");
        std::fs::write(&f, b"PK").unwrap();
        let registry = registry_with(&f);
        let id = book_id(&f.to_string_lossy());
        assert_eq!(resolve_book(&registry, "c1", &id).unwrap(), f);
        assert_eq!(
            resolve_book(&registry, "c2", &id).unwrap_err().code,
            FsErrorCode::UnknownBook
        );
        assert_eq!(
            resolve_book(&registry, "c1", "0000000000000000")
                .unwrap_err()
                .code,
            FsErrorCode::UnknownBook
        );
        std::fs::remove_file(&f).unwrap();
        assert_eq!(
            resolve_book(&registry, "c1", &id).unwrap_err().code,
            FsErrorCode::NotFound
        );
        std::fs::create_dir(&f).unwrap();
        assert_eq!(
            resolve_book(&registry, "c1", &id).unwrap_err().code,
            FsErrorCode::NotFound
        );
    }
}
