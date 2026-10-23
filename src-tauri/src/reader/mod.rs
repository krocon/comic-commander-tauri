//! The reader (design 005): open books, their pages in reading order, page images through the
//! `ccpage` scheme.
//!
//! - `open` lists the book (by content, limits of 003), keeps the pages (`cover::choose::pages`:
//!   images only, natural order) and hands out a **token** (E7). At most [`MAX_SESSIONS`] books
//!   are open; the oldest is closed.
//! - Every open book gets one background **pass** (E1/E9): ZIP/TAR read the first bytes of each
//!   page for its size; 7z and solid RAR are unpacked once, in order, into the page cache – their
//!   page requests wait until the page is there. Closing cancels the pass.
//! - `serve` answers a page request: the bytes (direct from the book or the page cache), checked
//!   and maybe scaled ([`image::prepare`]); at most [`MAX_WORKING`] at once, more than
//!   [`MAX_WAITING`] waiting → 503 (E8); the last answers stay in a small memory cache.

pub mod image;
pub mod model;
pub mod page_cache;
pub mod url;

use crate::book::{self, Budget, Container, Entry, MAX_ENTRY_BYTES, TIME_LIMIT, Take};
use crate::cover::Reply;
use crate::cover::choose;
use crate::error::{FsError, FsErrorCode};
use model::{OpenedBook, PageDims, PageInfo, ReaderEvent};
use page_cache::{Complete, PageCache};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, Weak};
use std::time::{Duration, Instant, UNIX_EPOCH};
use url::PageRequest;

/// Books open at once (a reader per window; the oldest is closed).
pub const MAX_SESSIONS: usize = 4;
/// Page requests in work at once (E8).
pub const MAX_WORKING: usize = 4;
/// Page requests waiting at most (else 503).
pub const MAX_WAITING: usize = 16;
/// Memory cache of the last answers (E8).
pub const MEMORY_CACHE: usize = 64 << 20;
/// First bytes of a page read for its size (E9).
pub const DIMS_PREFIX: u64 = 128 << 10;
/// Time of the size pass over a ZIP/TAR.
pub const DIMS_TIME: Duration = Duration::from_secs(60);
/// Time to unpack a whole book.
pub const UNPACK_TIME: Duration = Duration::from_secs(600);
/// Bytes unpacked per book at most.
pub const UNPACK_BYTES: u64 = 2 << 30;
/// Requests waiting for the unpacking at most (else 503).
pub const MAX_UNPACK_WAITERS: usize = 32;
/// How long a page request waits for the unpacking.
pub const PAGE_WAIT: Duration = Duration::from_secs(120);
/// Sizes are sent in batches of this many pages (or after [`DIMS_EVERY`]).
const DIMS_BATCH: usize = 32;
const DIMS_EVERY: Duration = Duration::from_millis(250);

pub type Sink = Arc<dyn Fn(ReaderEvent) + Send + Sync>;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Debug, Clone)]
enum Slot {
    Waiting,
    Ready,
    Failed(FsError),
}

/// Pages of a book that is unpacked into the page cache – **one per book**, shared by every
/// session of that book (review 005 #3: two passes would delete each other's pages).
struct Unpacked {
    key: String,
    slots: Mutex<Vec<Slot>>,
    /// Page sizes as far as known (for a second session of the same book).
    sizes: Mutex<Vec<Option<(u32, u32)>>>,
    changed: Condvar,
    /// The folder was complete when it was found (nothing to unpack).
    from_cache: bool,
    /// Sessions using it; the pass stops when the last one closes.
    users: AtomicUsize,
    cancel: AtomicBool,
}

impl Unpacked {
    fn set(&self, index: usize, slot: Slot) {
        if let Some(s) = lock(&self.slots).get_mut(index) {
            *s = slot;
        }
        self.changed.notify_all();
    }

    fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::Relaxed)
    }

    /// Every page still waiting fails with `e`.
    fn fail_waiting(&self, e: &FsError) {
        for s in lock(&self.slots).iter_mut() {
            if matches!(s, Slot::Waiting) {
                *s = Slot::Failed(e.clone());
            }
        }
        self.changed.notify_all();
    }
}

/// An open book.
pub struct Session {
    pub token: String,
    pub book: PathBuf,
    container: Container,
    /// Reading order.
    pages: Vec<Entry>,
    unpacked: Option<Arc<Unpacked>>,
    cancel: AtomicBool,
}

impl Session {
    pub fn page_count(&self) -> usize {
        self.pages.len()
    }

    fn closed(&self) -> FsError {
        FsError::new(FsErrorCode::NotFound, "the book was closed", None)
    }

    /// The bytes of page `index` (blocking: reads the book or waits for the unpacking).
    fn page_bytes(&self, index: usize, cache: &PageCache) -> Result<Vec<u8>, FsError> {
        let entry = self
            .pages
            .get(index)
            .ok_or_else(|| FsError::new(FsErrorCode::NotFound, "no such page", None))?;
        let Some(u) = &self.unpacked else {
            let budget = Budget::new(TIME_LIMIT, Some(&self.cancel));
            return book::read(&self.book, self.container, entry, MAX_ENTRY_BYTES, &budget);
        };
        // `serve` has waited already (outside the gate) – still waiting: busy, ask again
        match lock(&u.slots)[index].clone() {
            Slot::Ready => {}
            Slot::Failed(e) => return Err(e),
            Slot::Waiting if self.cancel.load(Ordering::Relaxed) => return Err(self.closed()),
            Slot::Waiting => {
                return Err(FsError::new(
                    FsErrorCode::Busy,
                    "the page is not unpacked yet",
                    None,
                ));
            }
        }
        let file = cache.page_file(&u.key, index);
        std::fs::read(&file).map_err(|e| {
            // removed under us (should not happen: open books are never trimmed) – busy, not broken
            if e.kind() == std::io::ErrorKind::NotFound {
                FsError::new(
                    FsErrorCode::Busy,
                    "the page is gone from the cache",
                    Some(&file),
                )
            } else {
                FsError::from_io(&e, &file)
            }
        })
    }
}

/// Collects sizes and sends them in batches.
struct DimsBatcher<'a> {
    sink: &'a Sink,
    batch: Vec<PageDims>,
    last: Instant,
}

impl<'a> DimsBatcher<'a> {
    fn new(sink: &'a Sink) -> Self {
        Self {
            sink,
            batch: Vec::new(),
            last: Instant::now(),
        }
    }

    fn push(&mut self, index: usize, data: &[u8]) {
        if let Some((width, height)) = image::dimensions(data) {
            self.batch.push(PageDims {
                index,
                width,
                height,
            });
        }
        if self.batch.len() >= DIMS_BATCH || self.last.elapsed() >= DIMS_EVERY {
            self.flush();
        }
    }

    fn flush(&mut self) {
        self.last = Instant::now();
        if !self.batch.is_empty() {
            (self.sink)(ReaderEvent::Dims {
                pages: std::mem::take(&mut self.batch),
            });
        }
    }
}

/// The background pass of a session (runs on its own thread).
fn run_pass(session: &Session, cache: &PageCache, sink: &Sink, unpack_pass: bool) {
    let index_of: HashMap<usize, usize> = session
        .pages
        .iter()
        .enumerate()
        .map(|(i, e)| (e.pos, i))
        .collect();
    let mut dims = DimsBatcher::new(sink);
    let outcome = match &session.unpacked {
        None => {
            if session.container == Container::Rar {
                // non-solid RAR: no cheap header pass – the frontend learns sizes on load (E9)
                Ok(())
            } else {
                let positions: Vec<usize> = session.pages.iter().map(|e| e.pos).collect();
                let budget = Budget::new(DIMS_TIME, Some(&session.cancel));
                book::read_many(
                    &session.book,
                    session.container,
                    &positions,
                    Take::Prefix(DIMS_PREFIX),
                    &budget,
                    &mut |pos, data| {
                        if let (Some(i), Ok(d)) = (index_of.get(&pos), data) {
                            dims.push(*i, &d);
                        }
                        true
                    },
                )
            }
        }
        // a second session of a book being unpacked: the first one's pass does the work
        Some(_) if !unpack_pass => Ok(()),
        Some(u) => unpack(session, u, cache, &index_of, &mut dims),
    };
    dims.flush();
    let stopped = match &session.unpacked {
        Some(u) if unpack_pass => u.cancelled(),
        _ => session.cancel.load(Ordering::Relaxed),
    };
    if stopped {
        if let Some(u) = &session.unpacked
            && unpack_pass
        {
            u.fail_waiting(&session.closed());
        }
        return;
    }
    if !unpack_pass && session.unpacked.is_some() {
        // sizes of a shared unpacking: what is known so far; the rest arrives on load
        return sink(ReaderEvent::Done);
    }
    match outcome {
        Ok(()) => sink(ReaderEvent::Done),
        Err(error) => {
            if let Some(u) = &session.unpacked {
                u.fail_waiting(&error);
            }
            sink(ReaderEvent::Failed { error })
        }
    }
}

/// Unpacks the pages of a sequential book (E1); a complete earlier run is used as it is.
fn unpack(
    session: &Session,
    u: &Unpacked,
    cache: &PageCache,
    index_of: &HashMap<usize, usize>,
    dims: &mut DimsBatcher<'_>,
) -> Result<(), FsError> {
    let book = &session.book;
    if u.from_cache {
        // `open` has set the slots and sizes from the marker
        return Ok(());
    }
    cache
        .reset(&u.key)
        .map_err(|e| FsError::from_io(&e, &cache.book_dir(&u.key)))?;
    let n = session.pages.len();
    let mut sizes: Vec<Option<(u32, u32)>> = vec![None; n];
    let mut failed: Vec<(usize, String)> = Vec::new();
    let mut written: u64 = 0;
    let mut write_error: Option<FsError> = None;
    let positions: Vec<usize> = session.pages.iter().map(|e| e.pos).collect();
    let budget = Budget::new(UNPACK_TIME, Some(&u.cancel));
    // never more than the whole cache (review 005 #5)
    let max_bytes = UNPACK_BYTES.min(cache.limit());
    book::read_many(
        book,
        session.container,
        &positions,
        Take::Whole(MAX_ENTRY_BYTES),
        &budget,
        &mut |pos, data| {
            let Some(&i) = index_of.get(&pos) else {
                return true;
            };
            match data {
                Ok(d) => {
                    written += d.len() as u64;
                    if written > max_bytes {
                        write_error = Some(book::too_large(
                            format!("more than {} MiB of pages", max_bytes >> 20),
                            book,
                        ));
                        return false;
                    }
                    if let Err(e) = cache.write_page(&u.key, i, &d) {
                        write_error = Some(FsError::from_io(&e, &cache.page_file(&u.key, i)));
                        return false;
                    }
                    sizes[i] = image::dimensions(&d);
                    if let Some(s) = lock(&u.sizes).get_mut(i) {
                        *s = sizes[i];
                    }
                    dims.push(i, &d);
                    u.set(i, Slot::Ready);
                }
                Err(e) => {
                    failed.push((i, error_code(&e)));
                    u.set(i, Slot::Failed(e));
                }
            }
            true
        },
    )?;
    if let Some(e) = write_error {
        return Err(e);
    }
    // a page the pass never met (lying header) must not wait forever
    u.fail_waiting(&book::archive_error("page not found in the book", book));
    let marker = Complete {
        pages: sizes,
        failed,
    };
    // a missing marker only means unpacking again next time
    let _ = cache.mark_complete(&u.key, &marker);
    Ok(())
}

fn error_code(e: &FsError) -> String {
    serde_json::to_value(e.code)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_else(|| "archive_error".into())
}

fn code_from(s: &str) -> FsErrorCode {
    serde_json::from_value(serde_json::Value::String(s.to_owned()))
        .unwrap_or(FsErrorCode::ArchiveError)
}

/// A counting gate: at most `working` at once, at most `waiting` in the queue.
struct Gate {
    state: Mutex<(usize, usize)>,
    freed: Condvar,
}

struct GatePass<'a>(&'a Gate);

impl Drop for GatePass<'_> {
    fn drop(&mut self) {
        lock(&self.0.state).0 -= 1;
        self.0.freed.notify_one();
    }
}

impl Gate {
    fn enter(&self) -> Option<GatePass<'_>> {
        let mut s = lock(&self.state);
        if s.0 >= MAX_WORKING {
            if s.1 >= MAX_WAITING {
                return None;
            }
            s.1 += 1;
            while s.0 >= MAX_WORKING {
                s = self.freed.wait(s).unwrap_or_else(|e| e.into_inner());
            }
            s.1 -= 1;
        }
        s.0 += 1;
        Some(GatePass(self))
    }
}

/// (token, page, width) of an answer.
type AnswerKey = (String, usize, u32);

/// Last answers: key → bytes, MIME type.
#[derive(Default)]
struct Memory {
    items: VecDeque<(AnswerKey, Arc<Vec<u8>>, &'static str)>,
    bytes: usize,
}

impl Memory {
    fn get(&mut self, key: &AnswerKey) -> Option<(Arc<Vec<u8>>, &'static str)> {
        let i = self.items.iter().position(|(k, ..)| k == key)?;
        let item = self.items.remove(i)?;
        let out = (item.1.clone(), item.2);
        self.items.push_back(item);
        Some(out)
    }

    fn put(&mut self, key: AnswerKey, data: Arc<Vec<u8>>, mime: &'static str) {
        if data.len() > MEMORY_CACHE / 4 {
            return;
        }
        self.bytes += data.len();
        self.items.push_back((key, data, mime));
        while self.bytes > MEMORY_CACHE {
            match self.items.pop_front() {
                Some((_, d, _)) => self.bytes -= d.len(),
                None => break,
            }
        }
    }

    fn forget(&mut self, token: &str) {
        self.items.retain(|((t, ..), d, _)| {
            let keep = t != token;
            if !keep {
                self.bytes -= d.len();
            }
            keep
        });
    }
}

pub struct ReaderService {
    sessions: Mutex<VecDeque<Arc<Session>>>,
    /// Books being read from the page cache, by key – also the lock that keeps `trim` and
    /// `open` apart (review 005 #7).
    unpacks: Mutex<HashMap<String, Weak<Unpacked>>>,
    /// Requests waiting for a page to be unpacked (review 005 #4).
    unpack_waiters: AtomicUsize,
    cache: Arc<PageCache>,
    gate: Gate,
    memory: Mutex<Memory>,
    counter: AtomicU64,
}

fn modified_ms(meta: &std::fs::Metadata) -> i64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as i64)
}

impl ReaderService {
    pub fn new(cache_dir: &Path, limit: u64) -> Arc<Self> {
        Arc::new(Self {
            sessions: Mutex::new(VecDeque::new()),
            unpacks: Mutex::new(HashMap::new()),
            unpack_waiters: AtomicUsize::new(0),
            cache: Arc::new(PageCache::new(cache_dir, limit)),
            gate: Gate {
                state: Mutex::new((0, 0)),
                freed: Condvar::new(),
            },
            memory: Mutex::new(Memory::default()),
            counter: AtomicU64::new(0),
        })
    }

    /// Trims the page cache (books in use stay). Returns (books removed, bytes left).
    pub fn trim_cache(&self) -> (usize, u64) {
        let mut unpacks = lock(&self.unpacks);
        unpacks.retain(|_, w| w.strong_count() > 0);
        let keep: HashSet<String> = unpacks.keys().cloned().collect();
        self.cache.trim(&keep)
    }

    fn new_token(&self, book: &Path) -> String {
        let n = self.counter.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_nanos());
        let mut bytes = format!("{n}\0{nanos}\0{:p}\0", self).into_bytes();
        bytes.extend_from_slice(book.to_string_lossy().as_bytes());
        format!("{:016x}", crate::categories::fnv64(&bytes))
    }

    /// Opens `book` (blocking: lists it) and starts its pass; events go to `sink`.
    /// `last_page` of the answer is left to the caller (reading state).
    pub fn open(self: &Arc<Self>, book: &Path, sink: Sink) -> Result<OpenedBook, FsError> {
        let meta = std::fs::metadata(book).map_err(|e| FsError::from_io(&e, book))?;
        let budget = Budget::new(TIME_LIMIT, None);
        let (container, entries) = book::list(book, &budget)?;
        let pages: Vec<Entry> = choose::pages(&entries).into_iter().cloned().collect();
        if pages.is_empty() {
            return Err(FsError::new(
                FsErrorCode::NoImage,
                "no image in the book",
                Some(book),
            ));
        }
        let sequential = book::is_sequential(book, container)?;
        let mut infos: Vec<PageInfo> = pages
            .iter()
            .map(|e| PageInfo {
                name: e.name.clone(),
                size: e.size,
                width: None,
                height: None,
            })
            .collect();
        let mut unpacked = None;
        let mut unpack_pass = false;
        if sequential {
            let key = page_cache::key(book, meta.len(), modified_ms(&meta));
            let mut unpacks = lock(&self.unpacks);
            let shared = unpacks
                .get(&key)
                .and_then(Weak::upgrade)
                .filter(|u| !u.cancelled() && lock(&u.slots).len() == pages.len());
            let u = match shared {
                Some(u) => u,
                None => {
                    let n = pages.len();
                    let mut slots = vec![Slot::Waiting; n];
                    let mut sizes = vec![None; n];
                    // a marker of another page count (other app version) is not trusted (review 005 #1)
                    let complete = self.cache.complete(&key).filter(|c| c.pages.len() == n);
                    if let Some(c) = &complete {
                        slots = vec![Slot::Ready; n];
                        sizes.clone_from(&c.pages);
                        for (i, code) in &c.failed {
                            if let Some(s) = slots.get_mut(*i) {
                                *s = Slot::Failed(FsError::new(
                                    code_from(code),
                                    "failed before",
                                    None,
                                ));
                            }
                        }
                    }
                    unpack_pass = true;
                    let u = Arc::new(Unpacked {
                        key: key.clone(),
                        slots: Mutex::new(slots),
                        sizes: Mutex::new(sizes),
                        changed: Condvar::new(),
                        from_cache: complete.is_some(),
                        users: AtomicUsize::new(0),
                        cancel: AtomicBool::new(false),
                    });
                    unpacks.insert(key, Arc::downgrade(&u));
                    u
                }
            };
            u.users.fetch_add(1, Ordering::SeqCst);
            for (info, size) in infos.iter_mut().zip(lock(&u.sizes).iter()) {
                if let Some((w, h)) = size {
                    info.width = Some(*w);
                    info.height = Some(*h);
                }
            }
            unpacked = Some(u);
        }
        let session = Arc::new(Session {
            token: self.new_token(book),
            book: book.to_path_buf(),
            container,
            pages,
            unpacked,
            cancel: AtomicBool::new(false),
        });
        let closed: Vec<Arc<Session>> = {
            let mut list = lock(&self.sessions);
            list.push_back(session.clone());
            let mut out = Vec::new();
            while list.len() > MAX_SESSIONS {
                out.extend(list.pop_front());
            }
            out
        };
        for s in closed {
            self.cancel(&s);
        }
        if unpack_pass {
            // room for this book before it is unpacked (books in use stay)
            self.trim_cache();
        }
        let (me, s) = (self.clone(), session.clone());
        std::thread::spawn(move || {
            run_pass(&s, &me.cache, &sink, unpack_pass);
            if unpack_pass && s.unpacked.as_ref().is_some_and(|u| !u.from_cache) {
                // a big book may have pushed the cache over its limit (review 005 #5)
                me.trim_cache();
            }
        });
        Ok(OpenedBook {
            token: session.token.clone(),
            pages: infos,
            last_page: None,
            extracting: sequential,
        })
    }

    fn cancel(&self, s: &Session) {
        if s.cancel.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Some(u) = &s.unpacked {
            // the last reader of this book: its unpacking stops
            if u.users.fetch_sub(1, Ordering::SeqCst) == 1 {
                u.cancel.store(true, Ordering::SeqCst);
            }
            u.changed.notify_all();
        }
        lock(&self.memory).forget(&s.token);
    }

    /// Closes the book of `token` (unknown: nothing to do).
    pub fn close(&self, token: &str) {
        let removed = {
            let mut list = lock(&self.sessions);
            list.iter()
                .position(|s| s.token == token)
                .and_then(|i| list.remove(i))
        };
        if let Some(s) = removed {
            self.cancel(&s);
        }
    }

    pub fn session(&self, token: &str) -> Option<Arc<Session>> {
        lock(&self.sessions)
            .iter()
            .find(|s| s.token == token)
            .cloned()
    }

    /// Answers a page request (blocking).
    pub fn serve(&self, req: &PageRequest) -> Reply {
        let Some(session) = self.session(&req.token) else {
            return Reply::status(404);
        };
        if req.index >= session.page_count() {
            return Reply::status(404);
        }
        let key = (req.token.clone(), req.index, req.width);
        if let Some((data, mime)) = lock(&self.memory).get(&key) {
            return Reply::image(data.as_ref().clone(), mime);
        }
        // waiting for the unpacking happens outside the gate – bounded (review 005 #4)
        if let Some(u) = &session.unpacked
            && matches!(lock(&u.slots)[req.index], Slot::Waiting)
        {
            if self.unpack_waiters.fetch_add(1, Ordering::SeqCst) >= MAX_UNPACK_WAITERS {
                self.unpack_waiters.fetch_sub(1, Ordering::SeqCst);
                return Reply::status(503);
            }
            let deadline = Instant::now() + PAGE_WAIT;
            let mut slots = lock(&u.slots);
            while matches!(slots[req.index], Slot::Waiting)
                && Instant::now() < deadline
                && !session.cancel.load(Ordering::Relaxed)
            {
                slots = u
                    .changed
                    .wait_timeout(slots, Duration::from_millis(500))
                    .unwrap_or_else(|e| e.into_inner())
                    .0;
            }
            drop(slots);
            self.unpack_waiters.fetch_sub(1, Ordering::SeqCst);
        }
        let Some(_pass) = self.gate.enter() else {
            return Reply::status(503);
        };
        let outcome = session
            .page_bytes(req.index, &self.cache)
            .and_then(|data| image::prepare(data, req.width, &session.book));
        match outcome {
            Ok((data, mime)) => {
                let data = Arc::new(data);
                if !session.cancel.load(Ordering::Relaxed) {
                    lock(&self.memory).put(key, data.clone(), mime);
                }
                Reply::image(Arc::try_unwrap(data).unwrap_or_else(|a| (*a).clone()), mime)
            }
            Err(e) if e.code == FsErrorCode::NotFound && session.cancel.load(Ordering::Relaxed) => {
                Reply::status(404)
            }
            Err(e) => Reply::error(&e),
        }
    }
}

#[cfg(test)]
mod tests;
