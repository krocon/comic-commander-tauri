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
    if is_program(&path, &meta) {
        return Err(FsError::new(
            FsErrorCode::UnsupportedFormat,
            "the book is a program",
            Some(&path),
        ));
    }
    Ok(path)
}

/// Executable with a shebang or ELF/Mach-O header – books never are (review 004 #10; the OS
/// could run it instead of opening a viewer).
#[cfg(unix)]
fn is_program(path: &Path, meta: &std::fs::Metadata) -> bool {
    use std::io::Read;
    use std::os::unix::fs::PermissionsExt;
    if meta.permissions().mode() & 0o111 == 0 {
        return false;
    }
    let mut head = [0u8; 4];
    let n = std::fs::File::open(path)
        .and_then(|mut f| f.read(&mut head))
        .unwrap_or(0);
    let head = &head[..n];
    head.starts_with(b"#!")
        || head.starts_with(b"\x7fELF")
        || [
            [0xFE, 0xED, 0xFA, 0xCE],
            [0xFE, 0xED, 0xFA, 0xCF],
            [0xCE, 0xFA, 0xED, 0xFE],
            [0xCF, 0xFA, 0xED, 0xFE],
            [0xCA, 0xFE, 0xBA, 0xBE],
        ]
        .iter()
        .any(|m| head == m)
}

/// Windows decides by extension; a book has the extension of its category.
#[cfg(not(unix))]
fn is_program(_path: &Path, _meta: &std::fs::Metadata) -> bool {
    false
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

    /// A listed „book“ that is a program (e.g. a link `x.cbz` to an executable) is never handed
    /// to the OS (review 004 #10).
    #[cfg(unix)]
    #[test]
    fn programs_are_not_opened() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap();
        for (name, head) in [
            ("elf.cbz", &b"\x7fELF\x02"[..]),
            ("script.cbz", &b"#!/bin/sh"[..]),
        ] {
            let f = d.path().join(name);
            std::fs::write(&f, head).unwrap();
            std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o755)).unwrap();
            let registry = registry_with(&f);
            let id = book_id(&f.to_string_lossy());
            assert_eq!(
                resolve_book(&registry, "c1", &id).unwrap_err().code,
                FsErrorCode::UnsupportedFormat,
                "{name}"
            );
            // the same bytes without the exec bit: a (broken) book, fine to open
            std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o644)).unwrap();
            resolve_book(&registry, "c1", &id).unwrap();
        }
    }
}
