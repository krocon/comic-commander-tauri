//! Reading comic books (design 003): the container is detected from its **content** (magic
//! bytes), not the extension – a `.cbr` that is a ZIP works (8 of them in Marc's collection).
//! Only what covers (and later the reader) need: the list of files and one entry read into
//! memory. Nothing is ever written to disk.
//!
//! Foreign books are hostile: every list is bounded ([`MAX_ENTRIES`]), every entry is read
//! with a byte limit, every read checks a [`Budget`] (time limit + cancel flag). Encrypted books
//! are `archive_encrypted` – covers never ask for a password.
//!
//! Formats: ZIP (`zip`), TAR (`tar`), 7z (`sevenz-rust2` behind the fail-closed header check of
//! files-and-folders), RAR (UnRAR via `unrar-ng-sys`, the only `unsafe` code). PDF is detected
//! and reported as `unsupported_format` until prompt 006.

mod rar;
mod sevenz;
mod sevenz_header;
mod tar_book;
mod zip_book;

use crate::error::{FsError, FsErrorCode};
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// Entries per book at most.
pub const MAX_ENTRIES: usize = 200_000;
/// Largest dictionary / model memory a 7z block or RAR entry may ask for. Real comics use 4–32 MiB;
/// files-and-folders allows 1 GiB for extraction – too much for 4 cover workers (review 003 #2).
pub const MAX_DICT: u64 = 256 << 20;
/// Bytes decoded and dropped before the wanted entry of a solid book (review 003 #2).
pub const MAX_SKIPPED: u64 = 512 << 20;
/// Largest entry read into memory (a page).
pub const MAX_ENTRY_BYTES: u64 = 64 << 20;
/// Longest TAR metadata entry (GNU long name, PAX header) accepted.
pub const MAX_TAR_META: u64 = 64 << 10;
/// Time a cover may take (design 003 E9).
pub const TIME_LIMIT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Container {
    Zip,
    Rar,
    SevenZ,
    Tar,
    Pdf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    File,
    Dir,
    Link,
    Other,
}

/// A regular file inside a book.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    /// As stored, `/` or `\` as separators – for choosing and sorting only, never a path.
    pub name: String,
    /// Declared uncompressed size.
    pub size: u64,
    /// Position in the book (ZIP/7z index, ordinal in the TAR/RAR stream).
    pub pos: usize,
    pub encrypted: bool,
}

/// Time limit, cancel flag and skip limit of one operation.
pub struct Budget<'a> {
    deadline: Instant,
    cancel: Option<&'a AtomicBool>,
    skipped: AtomicU64,
    skip_limit: u64,
}

impl<'a> Budget<'a> {
    pub fn new(limit: Duration, cancel: Option<&'a AtomicBool>) -> Self {
        Self {
            deadline: Instant::now() + limit,
            cancel,
            skipped: AtomicU64::new(0),
            skip_limit: MAX_SKIPPED,
        }
    }

    /// Another limit for skipped data (tests).
    pub fn with_skip_limit(mut self, limit: u64) -> Self {
        self.skip_limit = limit;
        self
    }

    /// Counts `n` skipped bytes; `false` once more than the skip limit were skipped.
    fn skip(&self, n: usize) -> bool {
        self.skipped.fetch_add(n as u64, Ordering::Relaxed) + n as u64 <= self.skip_limit
    }

    fn skip_error(&self, path: &Path) -> FsError {
        too_large(
            format!(
                "more than {} MiB before the wanted entry",
                self.skip_limit >> 20
            ),
            path,
        )
    }

    /// `true` while the operation may go on.
    pub fn ok(&self) -> bool {
        Instant::now() < self.deadline && !self.cancel.is_some_and(|c| c.load(Ordering::Relaxed))
    }

    pub fn check(&self, path: &Path) -> Result<(), FsError> {
        if self.ok() {
            Ok(())
        } else {
            Err(timeout(path))
        }
    }
}

pub(crate) fn timeout(path: &Path) -> FsError {
    FsError::new(
        FsErrorCode::Timeout,
        "reading the book took too long",
        Some(path),
    )
}

pub(crate) fn archive_error(message: impl Into<String>, path: &Path) -> FsError {
    FsError::new(FsErrorCode::ArchiveError, message, Some(path))
}

pub(crate) fn too_large(message: impl Into<String>, path: &Path) -> FsError {
    FsError::new(FsErrorCode::ArchiveTooLarge, message, Some(path))
}

pub(crate) fn too_many(path: &Path) -> FsError {
    too_large(format!("more than {MAX_ENTRIES} entries"), path)
}

pub(crate) fn encrypted(path: &Path) -> FsError {
    FsError::new(
        FsErrorCode::ArchiveEncrypted,
        "the book is encrypted",
        Some(path),
    )
}

/// The container of `path`, from its first bytes.
pub fn detect(path: &Path) -> Result<Container, FsError> {
    let mut head = Vec::with_capacity(1024);
    File::open(path)
        .and_then(|f| f.take(1024).read_to_end(&mut head))
        .map_err(|e| FsError::from_io(&e, path))?;
    detect_bytes(&head).ok_or_else(|| {
        FsError::new(
            FsErrorCode::UnsupportedFormat,
            "unknown book format",
            Some(path),
        )
    })
}

pub fn detect_bytes(head: &[u8]) -> Option<Container> {
    if head.starts_with(b"PK\x03\x04")
        || head.starts_with(b"PK\x05\x06")
        || head.starts_with(b"PK\x07\x08")
    {
        Some(Container::Zip)
    } else if head.starts_with(b"Rar!\x1a\x07\x00") || head.starts_with(b"Rar!\x1a\x07\x01\x00") {
        Some(Container::Rar)
    } else if head.starts_with(&[b'7', b'z', 0xBC, 0xAF, 0x27, 0x1C]) {
        Some(Container::SevenZ)
    } else if head.get(257..262) == Some(b"ustar") {
        Some(Container::Tar)
    } else if head.windows(5).any(|w| w == b"%PDF-") {
        Some(Container::Pdf)
    } else {
        None
    }
}

/// The regular files of a book (bounded, checked against the budget).
pub fn list(path: &Path, budget: &Budget<'_>) -> Result<(Container, Vec<Entry>), FsError> {
    let container = detect(path)?;
    let entries = match container {
        Container::Zip => zip_book::list(path, budget)?,
        Container::Tar => tar_book::list(path, budget)?,
        Container::SevenZ => sevenz::list(path, budget)?,
        Container::Rar => rar_list(path, budget)?,
        Container::Pdf => {
            return Err(FsError::new(
                FsErrorCode::UnsupportedFormat,
                "PDF follows in prompt 006",
                Some(path),
            ));
        }
    };
    Ok((container, entries))
}

/// Reads one entry (at most `max_bytes`).
pub fn read(
    path: &Path,
    container: Container,
    entry: &Entry,
    max_bytes: u64,
    budget: &Budget<'_>,
) -> Result<Vec<u8>, FsError> {
    if entry.encrypted {
        return Err(encrypted(path));
    }
    if entry.size > max_bytes {
        return Err(too_large(
            format!("entry larger than {} MiB", max_bytes >> 20),
            path,
        ));
    }
    match container {
        Container::Zip => zip_book::read(path, entry, max_bytes, budget),
        Container::Tar => tar_book::read(path, entry, max_bytes, budget),
        Container::SevenZ => sevenz::read(path, entry, max_bytes, budget),
        Container::Rar => rar_read(path, entry, max_bytes, budget),
        Container::Pdf => Err(FsError::new(
            FsErrorCode::UnsupportedFormat,
            "PDF follows in prompt 006",
            Some(path),
        )),
    }
}

/// Reads `r` into memory: at most `max` bytes (else `archive_too_large` – the declared size can
/// lie), checking the budget every 64 KiB.
pub(crate) fn read_limited(
    r: &mut dyn Read,
    expected: u64,
    max: u64,
    budget: &Budget<'_>,
    path: &Path,
) -> Result<Vec<u8>, FsError> {
    let mut out = Vec::with_capacity(expected.min(max) as usize);
    let mut buf = vec![0u8; 64 << 10];
    loop {
        budget.check(path)?;
        let n = r
            .read(&mut buf)
            .map_err(|e| archive_error(format!("broken data: {e}"), path))?;
        if n == 0 {
            return Ok(out);
        }
        if out.len() as u64 + n as u64 > max {
            return Err(too_large(
                format!("entry larger than {} MiB", max >> 20),
                path,
            ));
        }
        out.extend_from_slice(&buf[..n]);
    }
}

/// Reads and drops `r` (an entry before the wanted one in a solid stream), at most
/// [`MAX_SKIPPED`] bytes per operation.
pub(crate) fn drain(r: &mut dyn Read, budget: &Budget<'_>, path: &Path) -> Result<(), FsError> {
    let mut buf = vec![0u8; 64 << 10];
    loop {
        budget.check(path)?;
        let n = r
            .read(&mut buf)
            .map_err(|e| archive_error(format!("broken data: {e}"), path))?;
        if n == 0 {
            return Ok(());
        }
        if !budget.skip(n) {
            return Err(budget.skip_error(path));
        }
    }
}

fn rar_list(path: &Path, budget: &Budget<'_>) -> Result<Vec<Entry>, FsError> {
    let (headers, header_encrypted) = rar::headers(path, MAX_ENTRIES, budget)?;
    if header_encrypted {
        return Err(encrypted(path));
    }
    budget.check(path)?;
    Ok(headers
        .into_iter()
        .enumerate()
        .filter(|(_, h)| h.kind == EntryKind::File)
        .map(|(pos, h)| Entry {
            name: h.name,
            size: h.size,
            pos,
            encrypted: h.encrypted,
        })
        .collect())
}

fn rar_read(
    path: &Path,
    entry: &Entry,
    max_bytes: u64,
    budget: &Budget<'_>,
) -> Result<Vec<u8>, FsError> {
    let mut archive = rar::RarArchive::open(path, true, budget.cancel)?;
    let mut pos = 0usize;
    while let Some(h) = archive.next_header()? {
        budget.check(path)?;
        if pos == entry.pos {
            if h.encrypted {
                return Err(encrypted(path));
            }
            let mut data: Vec<u8> = Vec::with_capacity(h.size.min(max_bytes) as usize);
            let mut too_big = false;
            let complete = archive.test_into(&h, &mut |chunk| {
                if data.len() as u64 + chunk.len() as u64 > max_bytes {
                    too_big = true;
                    return false;
                }
                data.extend_from_slice(chunk);
                budget.ok()
            })?;
            if too_big {
                return Err(too_large(
                    format!("entry larger than {} MiB", max_bytes >> 20),
                    path,
                ));
            }
            if !complete {
                return Err(timeout(path));
            }
            return Ok(data);
        }
        // a solid archive decodes skipped entries: through a sink that checks the budget
        let mut over = false;
        let went_on = if archive.solid {
            archive.test_into(&h, &mut |chunk| {
                over = !budget.skip(chunk.len());
                !over && budget.ok()
            })?
        } else {
            archive.skip(&h)?
        };
        if over {
            return Err(budget.skip_error(path));
        }
        if !went_on {
            return Err(timeout(path));
        }
        pos += 1;
    }
    Err(archive_error("entry not found", path))
}

#[cfg(test)]
pub(crate) mod tests;
