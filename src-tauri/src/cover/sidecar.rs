//! Thumbnails of the old comiccommander next to the books (design 003 E5, legacy §4): only
//! read, never written. For size *i* with `s = thumbsDims[i].nameExtension` and `…/Band.cbr`:
//! `Band{s}.jpg` → `Band.cbr{s}.jpg` → `.Panels/thumbnails/Band{s}.jpg` →
//! `.Panels/thumbnails/Band.cbr{s}.jpg` (the last two from the iPad app "Panels").

use std::ffi::OsString;
use std::io::Read;
use std::path::{Path, PathBuf};

/// Largest sidecar served.
pub const MAX_BYTES: u64 = 8 << 20;

fn with_suffix(base: &std::ffi::OsStr, suffix: &str) -> OsString {
    let mut n = base.to_os_string();
    n.push(suffix);
    n.push(".jpg");
    n
}

/// The places to look, in order.
pub fn candidates(book: &Path, suffix: &str) -> Vec<PathBuf> {
    let (Some(dir), Some(name), Some(stem)) = (book.parent(), book.file_name(), book.file_stem())
    else {
        return Vec::new();
    };
    let panels = dir.join(".Panels").join("thumbnails");
    vec![
        dir.join(with_suffix(stem, suffix)),
        dir.join(with_suffix(name, suffix)),
        panels.join(with_suffix(stem, suffix)),
        panels.join(with_suffix(name, suffix)),
    ]
}

fn mime_of(head: &[u8]) -> Option<&'static str> {
    if head.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if head.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else {
        None
    }
}

/// The first usable sidecar: a regular file of at most [`MAX_BYTES`] that is a JPEG or PNG.
/// A usable sidecar exists (size only – `find` checks the content when it is served).
pub fn exists(book: &Path, suffix: &str) -> bool {
    candidates(book, suffix).into_iter().any(|p| {
        std::fs::metadata(&p).is_ok_and(|m| m.is_file() && m.len() >= 8 && m.len() <= MAX_BYTES)
    })
}

pub fn find(book: &Path, suffix: &str) -> Option<(Vec<u8>, &'static str)> {
    candidates(book, suffix).into_iter().find_map(|p| {
        let meta = std::fs::metadata(&p).ok()?;
        if !meta.is_file() || meta.len() > MAX_BYTES || meta.len() < 8 {
            return None;
        }
        let mut data = Vec::new();
        std::fs::File::open(&p)
            .ok()?
            .take(MAX_BYTES + 1)
            .read_to_end(&mut data)
            .ok()?;
        if data.len() as u64 > MAX_BYTES {
            return None;
        }
        mime_of(&data).map(|m| (data, m))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::book::tests::build;
    use std::fs;

    #[test]
    fn order_and_suffix_like_the_old_app() {
        let d = tempfile::tempdir().unwrap();
        let book = d.path().join("Der Henker 01 – Göttlich.cbr");
        fs::write(&book, b"x").unwrap();
        let c = candidates(&book, "_xl");
        let names: Vec<String> = c
            .iter()
            .map(|p| {
                p.strip_prefix(d.path())
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(
            names,
            [
                "Der Henker 01 – Göttlich_xl.jpg",
                "Der Henker 01 – Göttlich.cbr_xl.jpg",
                ".Panels/thumbnails/Der Henker 01 – Göttlich_xl.jpg",
                ".Panels/thumbnails/Der Henker 01 – Göttlich.cbr_xl.jpg",
            ]
        );
        assert!(find(&book, "_xl").is_none());
        // the Panels one is found; a later candidate does not win over an earlier one
        fs::create_dir_all(d.path().join(".Panels/thumbnails")).unwrap();
        fs::write(&c[3], build::jpeg(20, 30, 1)).unwrap();
        assert_eq!(find(&book, "_xl").unwrap().0, build::jpeg(20, 30, 1));
        fs::write(&c[0], build::jpeg(20, 30, 2)).unwrap();
        assert_eq!(find(&book, "_xl").unwrap().0, build::jpeg(20, 30, 2));
        // another size has its own file
        assert!(find(&book, "").is_none());
    }

    #[test]
    fn junk_sidecars_are_ignored() {
        let d = tempfile::tempdir().unwrap();
        let book = d.path().join("B.cbz");
        let c = candidates(&book, "");
        fs::write(&c[0], b"not an image at all").unwrap();
        fs::create_dir(&c[1]).unwrap();
        assert!(find(&book, "").is_none());
        fs::write(&c[0], vec![0xFF; (MAX_BYTES + 1) as usize]).unwrap();
        assert!(find(&book, "").is_none());
    }
}
