//! Covers (design 003): the `cccover` URI scheme serves the thumbnail of a book.
//!
//! URL path `/<category id>.<book id>.<dimIndex>` (`?v=<mtime>` only for the WebView cache).
//! The book id comes from the scan ([`crate::book_registry`]): only books the scan listed can be
//! asked for – the WebView can never name a file (E1). Order: disk cache → sidecar of the old
//! app (E5) → cover pool (E9: open the book, choose the cover, read it, decode, thumbnail, JPEG,
//! cache). Failures are remembered for the session ([`CoverService::failures`]).

pub mod cache;
pub mod choose;
pub mod image;
pub mod pool;
pub mod sidecar;

use crate::book::{self, Budget, MAX_ENTRY_BYTES, TIME_LIMIT};
use crate::categories::ThumbsDim;
use crate::error::{FsError, FsErrorCode};
use cache::CoverCache;
use pool::Pool;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

pub const SCHEME: &str = "cccover";
/// Jobs waiting in the pool at most (E9).
pub const MAX_QUEUE: usize = 2000;

/// What the scheme handler asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoverRequest {
    pub category_id: String,
    pub book_id: String,
    pub dim_index: usize,
}

fn is_hex(s: &str) -> bool {
    s.bytes()
        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// Parses `/<category id>.<book id>.<dimIndex>` – strict: anything else is `None` (404).
pub fn parse_path(path: &str) -> Option<CoverRequest> {
    let p = path.strip_prefix('/').unwrap_or(path);
    let mut parts = p.split('.');
    let (cat, book, dim) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() {
        return None;
    }
    let cat_ok = cat.len() == 13 && cat.starts_with('c') && is_hex(&cat[1..]);
    let book_ok = book.len() == 16 && is_hex(book);
    let dim_index = dim
        .parse::<usize>()
        .ok()
        .filter(|d| *d < 16 && dim.len() <= 2)?;
    (cat_ok && book_ok).then(|| CoverRequest {
        category_id: cat.to_owned(),
        book_id: book.to_owned(),
        dim_index,
    })
}

/// The answer for the WebView.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reply {
    pub status: u16,
    pub mime: &'static str,
    pub body: Vec<u8>,
}

impl Reply {
    pub fn image(body: Vec<u8>, mime: &'static str) -> Self {
        Self {
            status: 200,
            mime,
            body,
        }
    }

    pub fn status(status: u16) -> Self {
        Self {
            status,
            mime: "text/plain",
            body: Vec::new(),
        }
    }

    /// The HTTP status of a failure (design 003 „Fehler und Status“).
    pub fn error(e: &FsError) -> Self {
        Self::status(match e.code {
            FsErrorCode::NotFound | FsErrorCode::NoImage => 404,
            FsErrorCode::UnsupportedFormat => 415,
            FsErrorCode::Busy => 503,
            FsErrorCode::ArchiveError
            | FsErrorCode::ArchiveTooLarge
            | FsErrorCode::ArchiveEncrypted
            | FsErrorCode::UnsupportedImage
            | FsErrorCode::Timeout
            | FsErrorCode::PermissionDenied => 422,
            _ => 500,
        })
    }
}

pub struct CoverService {
    cache: CoverCache,
    pool: Pool,
    /// Last failure per cache key in this session (not retried; for prompt 007).
    failures: Mutex<HashMap<String, FsErrorCode>>,
}

/// Makes the thumbnail of `book` (the slow part, runs in the pool).
/// Failures a retry cannot change (the key holds size and mtime): remembered for the session.
/// Time limit, busy, I/O (a sleeping NAS) are asked again next time (review 003 #5).
pub fn remembered(code: FsErrorCode) -> bool {
    use FsErrorCode as C;
    matches!(
        code,
        C::NoImage
            | C::UnsupportedFormat
            | C::UnsupportedImage
            | C::ArchiveError
            | C::ArchiveEncrypted
            | C::ArchiveTooLarge
    )
}

pub fn make_thumbnail(book: &Path, width: u32, height: u32) -> Result<Vec<u8>, FsError> {
    make_thumbnail_with(book, width, height, None)
}

/// [`make_thumbnail`] with a cancel flag (batch job, design 007).
pub fn make_thumbnail_with(
    book: &Path,
    width: u32,
    height: u32,
    cancel: Option<&std::sync::atomic::AtomicBool>,
) -> Result<Vec<u8>, FsError> {
    // PDF: page 1, embedded JPEG or rendered (design 006 E6)
    if book::detect(book)? == book::Container::Pdf {
        return crate::pdf::thumbnail(book, width, height);
    }
    let budget = Budget::new(TIME_LIMIT, cancel);
    let (container, entries) = book::list(book, &budget)?;
    let cover = choose::cover(&entries)
        .ok_or_else(|| FsError::new(FsErrorCode::NoImage, "no image in the book", Some(book)))?;
    let data = book::read(book, container, cover, MAX_ENTRY_BYTES, &budget)?;
    budget.check(book)?;
    image::thumbnail_jpeg(&data, width, height, book)
}

/// What the batch job sees for a book and a size (design 007 E5).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoverState {
    /// In the cache or as a sidecar of the old app.
    Present,
    Missing,
    /// Failed before in this session (not opened again).
    Failed(FsErrorCode),
}

fn cache_key_of(book: &Path, dim: &ThumbsDim) -> Result<String, FsError> {
    let meta = std::fs::metadata(book).map_err(|e| FsError::from_io(&e, book))?;
    if !meta.is_file() {
        return Err(FsError::new(
            FsErrorCode::NotFound,
            "not a file",
            Some(book),
        ));
    }
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as i64);
    Ok(cache::key(
        book,
        meta.len(),
        modified_ms,
        dim.width,
        dim.height,
    ))
}

impl CoverService {
    /// Cover of `book` in size `dim`: there, missing or failed before (blocking, no decoding).
    pub fn state(&self, book: &Path, dim: &ThumbsDim) -> Result<CoverState, FsError> {
        let key = cache_key_of(book, dim)?;
        if self.cache.contains(&key) || sidecar::exists(book, &dim.name_extension) {
            return Ok(CoverState::Present);
        }
        Ok(
            match self
                .failures
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .get(&key)
            {
                Some(code) => CoverState::Failed(*code),
                None => CoverState::Missing,
            },
        )
    }

    /// Makes the cover of `book` in size `dim` now, on the calling thread (the batch job,
    /// design 007): into the cache, failures remembered like `serve` does.
    pub fn generate(
        &self,
        book: &Path,
        dim: &ThumbsDim,
        cancel: Option<&std::sync::atomic::AtomicBool>,
    ) -> Result<(), FsError> {
        let key = cache_key_of(book, dim)?;
        match make_thumbnail_with(book, dim.width, dim.height, cancel) {
            Ok(data) => self
                .cache
                .put(&key, &data)
                .map_err(|e| FsError::from_io(&e, book)),
            Err(e) => {
                if remembered(e.code) {
                    self.failures
                        .lock()
                        .unwrap_or_else(|p| p.into_inner())
                        .insert(key, e.code);
                }
                Err(e)
            }
        }
    }

    pub fn new(cache_dir: &Path, threads: usize) -> Arc<Self> {
        Arc::new(Self {
            cache: CoverCache::new(cache_dir, cache::DEFAULT_LIMIT),
            pool: Pool::new(threads, MAX_QUEUE),
            failures: Mutex::new(HashMap::new()),
        })
    }

    pub fn trim_cache(&self) -> (usize, u64) {
        self.cache.trim()
    }

    pub fn failures(&self) -> HashMap<String, FsErrorCode> {
        self.failures
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    /// Answers through `respond` – at once for cache hits and sidecars, else when the pool is
    /// done. Blocking (file I/O): never on the async runtime.
    pub fn serve(
        self: &Arc<Self>,
        book: PathBuf,
        dim: &ThumbsDim,
        respond: Box<dyn FnOnce(Reply) + Send>,
    ) {
        let meta = match std::fs::metadata(&book) {
            Ok(m) if m.is_file() => m,
            Ok(_) => return respond(Reply::status(404)),
            Err(e) => return respond(Reply::error(&FsError::from_io(&e, &book))),
        };
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_millis() as i64);
        let key = cache::key(&book, meta.len(), modified_ms, dim.width, dim.height);
        if let Some(data) = self.cache.get(&key) {
            return respond(Reply::image(data, "image/jpeg"));
        }
        if let Some((data, mime)) = sidecar::find(&book, &dim.name_extension) {
            return respond(Reply::image(data, mime));
        }
        if let Some(code) = self
            .failures
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&key)
        {
            return respond(Reply::error(&FsError::new(*code, "failed before", None)));
        }
        let me = self.clone();
        let (w, h) = (dim.width, dim.height);
        let job_key = key.clone();
        self.pool.submit(
            key,
            Box::new(move || {
                let outcome = make_thumbnail(&book, w, h);
                match &outcome {
                    // a cache that cannot be written only costs time next time
                    Ok(data) => {
                        let _ = me.cache.put(&job_key, data);
                    }
                    Err(e) if remembered(e.code) => {
                        me.failures
                            .lock()
                            .unwrap_or_else(|p| p.into_inner())
                            .insert(job_key, e.code);
                    }
                    Err(_) => {}
                }
                outcome
            }),
            Box::new(move |outcome| {
                respond(match outcome {
                    Ok(data) => Reply::image(data, "image/jpeg"),
                    Err(e) => Reply::error(&e),
                })
            }),
        );
    }
}

#[cfg(test)]
mod tests;
