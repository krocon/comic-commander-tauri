//! Running scans (design 002 E9): at most one scan per target (`baseDir` + extensions);
//! a second opener of the same target joins the running scan (like `runningScansPromises`
//! of the old app, legacy §3). Each scan runs on its own thread – never on the async
//! runtime –, at most [`MAX_PARALLEL`] at once.
//!
//! Event order for one opener:
//! - with cache:    `cached` → `started{firstScan:false}` → `progress`* → `diff` → `done`
//! - without cache: `started{firstScan:true}` → (`batch` | `progress`)* → `done`
//! - errors:        … → `failed{cacheKept}` | `cancelled`
//! - after `done`, when books have no metadata yet (design 011 E3): `metaProgress` / `meta`* →
//!   `metaDone{cancelled}`. The scan stays registered meanwhile; a new opener cancels this phase
//!   and gets a new walk once it is over (the `queued` path), which goes on with the rest.
//!
//! Pure Rust (no Tauri): events go to a [`Sink`]; the command layer wraps a `Channel`.

use crate::comic_info::{self, BookMeta};
use crate::error::{FsError, FsErrorCode};
use crate::model::{BookEntry, ScanStats};
use crate::scan::{self, WalkEvent, WalkOptions};
use crate::scan_cache::{self, ScanCache};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const MAX_PARALLEL: usize = 4;
pub const BATCH_BOOKS: usize = 500;
pub const BATCH_INTERVAL: Duration = Duration::from_millis(50);
pub const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);
/// Metadata are sent together this often (the frontend sorts once per message, design 011).
pub const META_INTERVAL: Duration = Duration::from_millis(500);
/// The cache is written this often during the ComicInfo pass – a cancel loses at most this.
pub const META_WRITE_INTERVAL: Duration = Duration::from_secs(10);
/// Books per message at most. One `cached` of 50 000 books (11 MB) got stuck in the IPC of
/// WebKitGTK – nothing arrived for minutes, and every later event waited behind it (design 004,
/// found in the E2E test). Cache, late openers and diffs go in parts of this size.
pub const MESSAGE_BOOKS: usize = 2000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ScanEvent {
    /// The cached books – the first part; `complete` = no `cachedMore` follows.
    Cached {
        books: Vec<BookEntry>,
        scanned_at: i64,
        stats: ScanStats,
        complete: bool,
    },
    /// More cached books (after `cached`), until `complete`.
    CachedMore {
        books: Vec<BookEntry>,
        complete: bool,
    },
    Started {
        first_scan: bool,
    },
    Batch {
        books: Vec<BookEntry>,
    },
    Progress {
        books: u64,
        dirs: u64,
    },
    Diff {
        added: Vec<BookEntry>,
        removed: Vec<String>,
        changed: Vec<BookEntry>,
    },
    Done {
        scanned_at: i64,
        stats: ScanStats,
    },
    Cancelled,
    Failed {
        error: FsError,
        cache_kept: bool,
    },
    /// ComicInfo pass (design 011): books done / to do.
    MetaProgress {
        done: u64,
        total: u64,
    },
    /// Metadata read since the last message (≤ [`MESSAGE_BOOKS`]).
    Meta {
        items: Vec<MetaItem>,
    },
    MetaDone {
        cancelled: bool,
    },
}

/// The metadata of one book (design 011).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaItem {
    pub id: String,
    pub meta: BookMeta,
}

pub type Sink = Arc<dyn Fn(ScanEvent) + Send + Sync>;

/// What is scanned.
#[derive(Debug, Clone)]
pub struct Target {
    pub base_dir: String,
    /// Normalised (lower case, with dot).
    pub extensions: Vec<String>,
}

struct Running {
    cancel: Arc<AtomicBool>,
    sinks: Vec<Sink>,
    /// Category ids that opened this scan (for `cancel_scan`).
    ids: HashSet<String>,
    first_scan: bool,
    /// Books already sent in batches (first scan) – a late opener gets them at once.
    sent: Vec<BookEntry>,
    /// Openers that came after a cancel, while the cancelled walk was still finishing: they
    /// get a new scan when it is gone (review 002 #2).
    queued: Vec<(String, Sink)>,
    /// The walk is over, the ComicInfo pass runs (design 011 E3).
    meta_phase: bool,
}

struct Inner {
    running: Mutex<HashMap<String, Running>>,
    active: Mutex<usize>,
    slot_free: Condvar,
    max_parallel: usize,
    dir_delay: Duration,
    walks: AtomicUsize,
    /// Scan threads alive (also while they deliver their last events).
    threads: AtomicUsize,
}

#[derive(Clone)]
pub struct ScanHub {
    inner: Arc<Inner>,
}

impl Default for ScanHub {
    fn default() -> Self {
        Self::with_options(MAX_PARALLEL, Duration::ZERO)
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Calls a sink; a panicking sink never takes the scan thread down.
fn deliver(sink: &Sink, event: ScanEvent) {
    let _ = catch_unwind(AssertUnwindSafe(|| sink(event)));
}

impl ScanHub {
    /// `dir_delay` slows every folder down – only for tests of concurrent scans.
    pub fn with_options(max_parallel: usize, dir_delay: Duration) -> Self {
        Self {
            inner: Arc::new(Inner {
                running: Mutex::new(HashMap::new()),
                active: Mutex::new(0),
                slot_free: Condvar::new(),
                max_parallel: max_parallel.max(1),
                dir_delay,
                walks: AtomicUsize::new(0),
                threads: AtomicUsize::new(0),
            }),
        }
    }

    /// Sends the cache (if any) and starts a scan – or joins the running one. Blocking
    /// (reads the cache file): call it off the async runtime.
    pub fn open(&self, cache_dir: &Path, category_id: &str, target: Target, sink: Sink) {
        let key = scan_cache::cache_key(&target.base_dir, &target.extensions);
        let cached = scan_cache::read(cache_dir, &target.base_dir, &target.extensions);
        if let Some(c) = &cached {
            for e in cached_events(&c.books, c.scanned_at, &c.stats) {
                deliver(&sink, e);
            }
        }
        let mut map = lock(&self.inner.running);
        if let Some(r) = map.get_mut(&key) {
            if r.meta_phase {
                // a new walk is wanted (reopened, rescan): end the ComicInfo pass, then walk
                // again – the pass goes on there with the rest (design 011 E3)
                r.cancel.store(true, Ordering::Relaxed);
            }
            if r.cancel.load(Ordering::Relaxed) {
                // the walk is cancelled but not gone yet: a new scan follows it
                deliver(
                    &sink,
                    ScanEvent::Started {
                        first_scan: cached.is_none(),
                    },
                );
                r.queued.push((category_id.to_owned(), sink));
                return;
            }
            r.ids.insert(category_id.to_owned());
            // `started` before the sink can receive batches (the store clears on a first scan)
            deliver(
                &sink,
                ScanEvent::Started {
                    first_scan: r.first_scan,
                },
            );
            let sent = (r.first_scan && !r.sent.is_empty()).then(|| r.sent.clone());
            r.sinks.push(sink.clone());
            drop(map);
            // the books so far – outside the lock (up to 500 000, review 002 #10)
            if let Some(books) = sent {
                for part in books.chunks(MESSAGE_BOOKS) {
                    deliver(
                        &sink,
                        ScanEvent::Batch {
                            books: part.to_vec(),
                        },
                    );
                }
            }
            return;
        }
        deliver(
            &sink,
            ScanEvent::Started {
                first_scan: cached.is_none(),
            },
        );
        start(
            &self.inner,
            &mut map,
            key,
            cache_dir,
            target,
            cached,
            vec![(category_id.to_owned(), sink)],
        );
    }

    /// Cancels the scan that `category_id` opened (no-op if none runs). Two categories with
    /// the same folder and file types share one scan – cancelling stops it for both.
    pub fn cancel(&self, category_id: &str) {
        for r in lock(&self.inner.running).values() {
            if r.ids.contains(category_id) {
                r.cancel.store(true, Ordering::Relaxed);
            }
        }
    }

    /// No scan registered and no scan thread still delivering events.
    pub fn is_idle(&self) -> bool {
        lock(&self.inner.running).is_empty() && self.inner.threads.load(Ordering::SeqCst) == 0
    }

    /// Cache keys of the scans that run now – `save_categories` keeps their caches.
    pub fn running_keys(&self) -> HashSet<String> {
        lock(&self.inner.running).keys().cloned().collect()
    }

    /// Number of walks started so far (tests).
    pub fn walks(&self) -> usize {
        self.inner.walks.load(Ordering::Relaxed)
    }
}

/// The cache as `cached` + `cachedMore` events of at most [`MESSAGE_BOOKS`] books.
pub fn cached_events(books: &[BookEntry], scanned_at: i64, stats: &ScanStats) -> Vec<ScanEvent> {
    let parts: Vec<&[BookEntry]> = if books.is_empty() {
        vec![&[]]
    } else {
        books.chunks(MESSAGE_BOOKS).collect()
    };
    let last = parts.len() - 1;
    parts
        .into_iter()
        .enumerate()
        .map(|(i, part)| {
            if i == 0 {
                ScanEvent::Cached {
                    books: part.to_vec(),
                    scanned_at,
                    stats: stats.clone(),
                    complete: i == last,
                }
            } else {
                ScanEvent::CachedMore {
                    books: part.to_vec(),
                    complete: i == last,
                }
            }
        })
        .collect()
}

/// A diff as one event – or several of at most [`MESSAGE_BOOKS`] entries when large (e.g. all
/// books changed after the collection was copied).
pub fn diff_events(
    added: Vec<BookEntry>,
    removed: Vec<String>,
    changed: Vec<BookEntry>,
) -> Vec<ScanEvent> {
    if added.len() + removed.len() + changed.len() <= MESSAGE_BOOKS {
        return vec![ScanEvent::Diff {
            added,
            removed,
            changed,
        }];
    }
    let mut events = Vec::new();
    for part in added.chunks(MESSAGE_BOOKS) {
        events.push(ScanEvent::Diff {
            added: part.to_vec(),
            removed: Vec::new(),
            changed: Vec::new(),
        });
    }
    for part in removed.chunks(MESSAGE_BOOKS) {
        events.push(ScanEvent::Diff {
            added: Vec::new(),
            removed: part.to_vec(),
            changed: Vec::new(),
        });
    }
    for part in changed.chunks(MESSAGE_BOOKS) {
        events.push(ScanEvent::Diff {
            added: Vec::new(),
            removed: Vec::new(),
            changed: part.to_vec(),
        });
    }
    events
}

/// Registers a new scan under `key` (the map lock is held by the caller) and starts its thread.
fn start(
    inner: &Arc<Inner>,
    map: &mut HashMap<String, Running>,
    key: String,
    cache_dir: &Path,
    target: Target,
    cached: Option<ScanCache>,
    openers: Vec<(String, Sink)>,
) {
    let cancel = Arc::new(AtomicBool::new(false));
    map.insert(
        key.clone(),
        Running {
            cancel: cancel.clone(),
            ids: openers.iter().map(|(id, _)| id.clone()).collect(),
            sinks: openers.into_iter().map(|(_, s)| s).collect(),
            first_scan: cached.is_none(),
            sent: Vec::new(),
            queued: Vec::new(),
            meta_phase: false,
        },
    );
    let inner = inner.clone();
    let cache_dir = cache_dir.to_path_buf();
    inner.threads.fetch_add(1, Ordering::SeqCst);
    std::thread::spawn(move || {
        run(&inner, &key, &cache_dir, &target, cached, &cancel);
        inner.threads.fetch_sub(1, Ordering::SeqCst);
    });
}

/// Sends `event` to every current subscriber of `key` (outside the lock).
fn broadcast(inner: &Inner, key: &str, event: ScanEvent, remember: Option<&[BookEntry]>) {
    let sinks: Vec<Sink> = {
        let mut map = lock(&inner.running);
        let Some(r) = map.get_mut(key) else { return };
        if let Some(books) = remember {
            r.sent.extend_from_slice(books);
        }
        r.sinks.clone()
    };
    for s in sinks {
        s(event.clone());
    }
}

fn run(
    inner: &Arc<Inner>,
    key: &str,
    cache_dir: &Path,
    target: &Target,
    cached: Option<ScanCache>,
    cancel: &AtomicBool,
) {
    {
        let mut active = lock(&inner.active);
        while *active >= inner.max_parallel {
            active = inner
                .slot_free
                .wait(active)
                .unwrap_or_else(|e| e.into_inner());
        }
        *active += 1;
    }
    inner.walks.fetch_add(1, Ordering::Relaxed);
    // a panic (walk, sink) must not keep the slot and the entry forever (review 002 #3)
    let (finals, new_cache) = catch_unwind(AssertUnwindSafe(|| {
        scan_once(inner, key, target, cached.as_ref(), cancel)
    }))
    .unwrap_or_else(|_| {
        (
            vec![ScanEvent::Failed {
                error: FsError::new(FsErrorCode::Io, "scan failed", None),
                cache_kept: cached.is_some(),
            }],
            None,
        )
    });
    {
        let mut active = lock(&inner.active);
        *active -= 1;
        inner.slot_free.notify_one();
    }
    let mut new_cache = new_cache;
    let needs_meta = !cancel.load(Ordering::Relaxed)
        && new_cache
            .as_ref()
            .is_some_and(|c| c.books.iter().any(|b| b.meta.is_none()));
    let queued = match new_cache.as_mut() {
        Some(cache) if needs_meta => {
            // the walk is done: write the cache, tell the openers, then read the ComicInfo of
            // the books without metadata – still registered, so a new opener queues (E3)
            let _ = scan_cache::write(cache_dir, cache);
            let sinks = {
                let mut map = lock(&inner.running);
                match map.get_mut(key) {
                    Some(r) => {
                        r.meta_phase = true;
                        r.sinks.clone()
                    }
                    None => Vec::new(),
                }
            };
            for e in finals {
                for s in &sinks {
                    deliver(s, e.clone());
                }
            }
            let mut read = Vec::new();
            let cancelled = catch_unwind(AssertUnwindSafe(|| {
                meta_pass(inner, key, cache_dir, cache, cancel, &mut read)
            }))
            .unwrap_or(true);
            let _ = scan_cache::write(cache_dir, cache);
            let (sinks, queued) = lock(&inner.running)
                .remove(key)
                .map(|r| (r.sinks, r.queued))
                .unwrap_or_default();
            for s in &sinks {
                deliver(s, ScanEvent::MetaDone { cancelled });
            }
            // openers that came during the pass may have read the cache before parts of it
            // were written: everything read in this pass
            for (_, s) in &queued {
                for part in read.chunks(MESSAGE_BOOKS) {
                    deliver(
                        s,
                        ScanEvent::Meta {
                            items: part.to_vec(),
                        },
                    );
                }
            }
            queued
        }
        _ => {
            // leave the map first, then write the cache: a late opener either joined before
            // (and gets the diff against the old cache) or starts a scan of its own (review 002 #4)
            let (sinks, queued) = lock(&inner.running)
                .remove(key)
                .map(|r| (r.sinks, r.queued))
                .unwrap_or_default();
            if let Some(cache) = &new_cache {
                // a cache that cannot be written only costs speed next time
                let _ = scan_cache::write(cache_dir, cache);
            }
            for e in finals {
                for s in &sinks {
                    deliver(s, e.clone());
                }
            }
            queued
        }
    };
    if queued.is_empty() {
        return;
    }
    // openers that came after a cancel: a new scan – or join one that started meanwhile
    let cached = scan_cache::read(cache_dir, &target.base_dir, &target.extensions);
    let mut map = lock(&inner.running);
    if let Some(r) = map.get_mut(key) {
        for (id, sink) in queued {
            r.ids.insert(id);
            if r.first_scan && !r.sent.is_empty() {
                deliver(
                    &sink,
                    ScanEvent::Batch {
                        books: r.sent.clone(),
                    },
                );
            }
            r.sinks.push(sink);
        }
    } else {
        start(
            inner,
            &mut map,
            key.to_owned(),
            cache_dir,
            target.clone(),
            cached,
            queued,
        );
    }
}

/// The ComicInfo pass (design 011 E3): reads the metadata of every book without, one after the
/// other, sends them in parts and writes the cache now and then. `read` gets every result (for
/// openers that queued meanwhile). Returns `true` when cancelled.
fn meta_pass(
    inner: &Inner,
    key: &str,
    cache_dir: &Path,
    cache: &mut ScanCache,
    cancel: &AtomicBool,
    read: &mut Vec<MetaItem>,
) -> bool {
    let todo: Vec<usize> = (0..cache.books.len())
        .filter(|&i| cache.books[i].meta.is_none())
        .collect();
    let total = todo.len() as u64;
    let mut pending: Vec<MetaItem> = Vec::new();
    let mut last_flush = Instant::now();
    let mut last_progress = Instant::now();
    let mut last_write = Instant::now();
    let flush = |pending: &mut Vec<MetaItem>| {
        if !pending.is_empty() {
            let items = std::mem::take(pending);
            broadcast(inner, key, ScanEvent::Meta { items }, None);
        }
    };
    broadcast(inner, key, ScanEvent::MetaProgress { done: 0, total }, None);
    let mut cancelled = false;
    for (n, &i) in todo.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            cancelled = true;
            break;
        }
        if !inner.dir_delay.is_zero() {
            std::thread::sleep(inner.dir_delay);
        }
        let book = &mut cache.books[i];
        if let Some(meta) = comic_info::outcome(&PathBuf::from(&book.path), Some(cancel)) {
            book.meta = Some(Box::new(meta.clone()));
            let item = MetaItem {
                id: book.id.clone(),
                meta,
            };
            read.push(item.clone());
            pending.push(item);
        }
        if pending.len() >= MESSAGE_BOOKS || last_flush.elapsed() >= META_INTERVAL {
            flush(&mut pending);
            last_flush = Instant::now();
        }
        if last_progress.elapsed() >= PROGRESS_INTERVAL {
            broadcast(
                inner,
                key,
                ScanEvent::MetaProgress {
                    done: n as u64 + 1,
                    total,
                },
                None,
            );
            last_progress = Instant::now();
        }
        if last_write.elapsed() >= META_WRITE_INTERVAL {
            let _ = scan_cache::write(cache_dir, cache);
            last_write = Instant::now();
        }
    }
    flush(&mut pending);
    if !cancelled {
        broadcast(
            inner,
            key,
            ScanEvent::MetaProgress { done: total, total },
            None,
        );
    }
    cancelled
}

/// One walk with batches and progress; returns the final events and the cache to write.
fn scan_once(
    inner: &Inner,
    key: &str,
    target: &Target,
    cached: Option<&ScanCache>,
    cancel: &AtomicBool,
) -> (Vec<ScanEvent>, Option<ScanCache>) {
    let first_scan = cached.is_none();
    let mut all: Vec<BookEntry> = Vec::new();
    let mut pending: Vec<BookEntry> = Vec::new();
    let mut last_batch = Instant::now();
    let mut last_progress = Instant::now();
    let opts = WalkOptions {
        dir_delay: inner.dir_delay,
        ..WalkOptions::new(&target.extensions)
    };
    let result = scan::walk(
        Path::new(&target.base_dir),
        &opts,
        cancel,
        &mut |event, stats: &ScanStats| {
            if let WalkEvent::Book(b) = event {
                if first_scan {
                    pending.push(b.clone());
                }
                all.push(b);
            }
            if first_scan
                && !pending.is_empty()
                && (pending.len() >= BATCH_BOOKS || last_batch.elapsed() >= BATCH_INTERVAL)
            {
                let books = std::mem::take(&mut pending);
                broadcast(
                    inner,
                    key,
                    ScanEvent::Batch {
                        books: books.clone(),
                    },
                    Some(&books),
                );
                last_batch = Instant::now();
            }
            if last_progress.elapsed() >= PROGRESS_INTERVAL {
                broadcast(
                    inner,
                    key,
                    ScanEvent::Progress {
                        books: stats.books,
                        dirs: stats.dirs,
                    },
                    None,
                );
                last_progress = Instant::now();
            }
        },
    );
    if first_scan && !pending.is_empty() && !cancel.load(Ordering::Relaxed) {
        let books = std::mem::take(&mut pending);
        broadcast(
            inner,
            key,
            ScanEvent::Batch {
                books: books.clone(),
            },
            Some(&books),
        );
    }
    match result {
        Err(error) => (
            vec![ScanEvent::Failed {
                error,
                cache_kept: cached.is_some(),
            }],
            None,
        ),
        Ok(outcome) if outcome.cancelled => (vec![ScanEvent::Cancelled], None),
        Ok(outcome) => {
            scan::sort_books(&mut all);
            if let Some(old) = cached {
                scan_cache::carry_meta(&old.books, &mut all);
            }
            let scanned_at = now_ms();
            let cache = ScanCache {
                version: scan_cache::VERSION,
                base_dir: target.base_dir.clone(),
                book_extensions: {
                    let mut e = target.extensions.clone();
                    e.sort();
                    e.dedup();
                    e
                },
                scanned_at,
                books: all,
                stats: outcome.stats.clone(),
            };
            let mut events = Vec::new();
            if let Some(old) = cached {
                let d = scan_cache::diff(&old.books, &cache.books);
                events.extend(diff_events(d.added, d.removed, d.changed));
            }
            events.push(ScanEvent::Done {
                scanned_at,
                stats: outcome.stats,
            });
            (events, Some(cache))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::FsErrorCode;
    use std::fs::{File, create_dir_all};

    type Log = Arc<Mutex<Vec<ScanEvent>>>;

    fn recorder() -> (Sink, Log) {
        let log: Log = Arc::default();
        let l = log.clone();
        (Arc::new(move |e| lock(&l).push(e)), log)
    }

    fn touch(root: &Path, rel: &str) {
        let p = root.join(rel);
        create_dir_all(p.parent().unwrap()).unwrap();
        File::create(p).unwrap();
    }

    fn target(root: &Path) -> Target {
        Target {
            base_dir: root.to_string_lossy().into_owned(),
            extensions: vec![".cbz".into(), ".cbr".into()],
        }
    }

    fn wait_idle(hub: &ScanHub) {
        let t = Instant::now();
        while !hub.is_idle() {
            assert!(t.elapsed() < Duration::from_secs(20), "scan did not finish");
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    fn kinds(log: &Log) -> Vec<&'static str> {
        lock(log)
            .iter()
            .map(|e| match e {
                ScanEvent::Cached { .. } => "cached",
                ScanEvent::CachedMore { .. } => "cachedMore",
                ScanEvent::Started { .. } => "started",
                ScanEvent::Batch { .. } => "batch",
                ScanEvent::Progress { .. } => "progress",
                ScanEvent::Diff { .. } => "diff",
                ScanEvent::Done { .. } => "done",
                ScanEvent::Cancelled => "cancelled",
                ScanEvent::Failed { .. } => "failed",
                ScanEvent::MetaProgress { .. } => "metaProgress",
                ScanEvent::Meta { .. } => "meta",
                ScanEvent::MetaDone { .. } => "metaDone",
            })
            .filter(|k| *k != "progress" && !k.starts_with("meta"))
            .collect()
    }

    /// The events of the ComicInfo pass (design 011): `metaProgress` collapsed to its last value.
    fn meta_events(log: &Log) -> Vec<ScanEvent> {
        lock(log)
            .iter()
            .filter(|e| {
                matches!(
                    e,
                    ScanEvent::Meta { .. }
                        | ScanEvent::MetaDone { .. }
                        | ScanEvent::MetaProgress { .. }
                )
            })
            .cloned()
            .collect()
    }

    fn meta_read(log: &Log) -> HashMap<String, BookMeta> {
        let mut m = HashMap::new();
        for e in lock(log).iter() {
            if let ScanEvent::Meta { items } = e {
                for i in items {
                    m.insert(i.id.clone(), i.meta.clone());
                }
            }
        }
        m
    }

    fn meta_totals(log: &Log) -> Vec<u64> {
        lock(log)
            .iter()
            .filter_map(|e| match e {
                ScanEvent::MetaProgress { done: 0, total } => Some(*total),
                _ => None,
            })
            .collect()
    }

    fn meta_done(log: &Log) -> Vec<bool> {
        lock(log)
            .iter()
            .filter_map(|e| match e {
                ScanEvent::MetaDone { cancelled } => Some(*cancelled),
                _ => None,
            })
            .collect()
    }

    fn comic(root: &Path, rel: &str, series: Option<&str>) {
        let p = root.join(rel);
        create_dir_all(p.parent().unwrap()).unwrap();
        let mut entries = vec![("p01.jpg", crate::book::tests::build::jpeg(4, 6, 1))];
        if let Some(s) = series {
            entries.push((
                "ComicInfo.xml",
                format!("<ComicInfo><Series>{s}</Series><Number>7</Number></ComicInfo>")
                    .into_bytes(),
            ));
        }
        crate::book::tests::build::cbz(&p, &entries);
    }

    fn cached_books(cache: &Path, lib: &Path) -> Vec<BookEntry> {
        let t = target(lib);
        scan_cache::read(cache, &t.base_dir, &t.extensions)
            .unwrap()
            .books
    }

    #[test]
    fn comicinfo_pass_after_done_and_only_once() {
        let lib = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        comic(lib.path(), "x/abc123.cbz", Some("Asterix"));
        comic(lib.path(), "Hägar 🦸 01.cbz", None);
        touch(lib.path(), "leer.cbz");
        let hub = ScanHub::default();
        let (sink, log) = recorder();
        hub.open(cache.path(), "c1", target(lib.path()), sink.clone());
        wait_idle(&hub);
        assert_eq!(kinds(&log), ["started", "batch", "done"]);
        // the pass comes after `done`
        let done_at = lock(&log)
            .iter()
            .position(|e| matches!(e, ScanEvent::Done { .. }))
            .unwrap();
        let first_meta = lock(&log)
            .iter()
            .position(|e| matches!(e, ScanEvent::MetaProgress { .. }))
            .unwrap();
        assert!(first_meta > done_at);
        assert_eq!(meta_totals(&log), [3]);
        assert_eq!(meta_done(&log), [false]);
        let read = meta_read(&log);
        let books = cached_books(cache.path(), lib.path());
        let asterix = books.iter().find(|b| b.name == "abc123.cbz").unwrap();
        assert_eq!(read[&asterix.id].series.as_deref(), Some("Asterix"));
        assert_eq!(asterix.meta.as_ref().unwrap().number.as_deref(), Some("7"));
        let hagar = books.iter().find(|b| b.name.starts_with("Hägar")).unwrap();
        assert_eq!(hagar.meta, Some(Box::default()));
        // an empty file is no book: lasting, read (empty)
        let leer = books.iter().find(|b| b.name == "leer.cbz").unwrap();
        assert_eq!(leer.meta, Some(Box::default()));

        // second scan: everything known, no pass; `cached` carries the metadata
        let (sink2, log2) = recorder();
        hub.open(cache.path(), "c1", target(lib.path()), sink2);
        wait_idle(&hub);
        assert!(meta_events(&log2).is_empty());
        let carried = lock(&log2).iter().any(|e| match e {
            ScanEvent::Cached { books, .. } => books
                .iter()
                .any(|b| b.meta.as_ref().and_then(|m| m.series.as_deref()) == Some("Asterix")),
            _ => false,
        });
        assert!(carried);

        // a changed book is read again – only that one
        std::thread::sleep(Duration::from_millis(20));
        comic(lib.path(), "x/abc123.cbz", Some("Obelix"));
        let (sink3, log3) = recorder();
        hub.open(cache.path(), "c1", target(lib.path()), sink3);
        wait_idle(&hub);
        assert_eq!(kinds(&log3), ["cached", "started", "diff", "done"]);
        assert_eq!(meta_totals(&log3), [1]);
        assert_eq!(
            meta_read(&log3)[&asterix.id].series.as_deref(),
            Some("Obelix")
        );
    }

    #[test]
    fn a_new_opener_ends_the_pass_and_the_next_walk_goes_on() {
        let lib = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        for i in 0..20 {
            comic(lib.path(), &format!("Band {i:02}.cbz"), Some("S"));
        }
        // the delay slows the walk (one folder) and every book of the pass
        let hub = ScanHub::with_options(4, Duration::from_millis(30));
        let (s1, l1) = recorder();
        hub.open(cache.path(), "c1", target(lib.path()), s1);
        let t = Instant::now();
        while meta_read(&l1).is_empty() {
            assert!(t.elapsed() < Duration::from_secs(10));
            std::thread::sleep(Duration::from_millis(5));
        }
        let (s2, l2) = recorder();
        hub.open(cache.path(), "c1", target(lib.path()), s2);
        wait_idle(&hub);
        assert_eq!(meta_done(&l1), [true]);
        assert_eq!(hub.walks(), 2);
        assert_eq!(kinds(&l2).first(), Some(&"cached"));
        assert_eq!(kinds(&l2).last(), Some(&"done"));
        assert_eq!(meta_done(&l2), [false]);
        let totals = meta_totals(&l2);
        assert_eq!(totals.len(), 1);
        assert!(
            totals[0] < 20,
            "the second pass only reads the rest: {totals:?}"
        );
        // the second opener knows every book's metadata (sent at the end of the first pass
        // plus its own pass, or in its `cached`)
        let mut known = meta_read(&l2);
        for e in lock(&l2).iter() {
            if let ScanEvent::Cached { books, .. } | ScanEvent::CachedMore { books, .. } = e {
                for b in books {
                    if let Some(m) = &b.meta {
                        known.insert(b.id.clone(), (**m).clone());
                    }
                }
            }
        }
        assert_eq!(known.len(), 20);
        assert!(
            cached_books(cache.path(), lib.path()).iter().all(|b| b
                .meta
                .as_ref()
                .and_then(|m| m.series.as_deref())
                == Some("S"))
        );
    }

    #[test]
    fn cancel_ends_the_pass_and_keeps_what_was_read() {
        let lib = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        for i in 0..20 {
            comic(lib.path(), &format!("Band {i:02}.cbz"), Some("S"));
        }
        let hub = ScanHub::with_options(4, Duration::from_millis(30));
        let (s1, l1) = recorder();
        hub.open(cache.path(), "c1", target(lib.path()), s1);
        let t = Instant::now();
        while meta_read(&l1).is_empty() {
            assert!(t.elapsed() < Duration::from_secs(10));
            std::thread::sleep(Duration::from_millis(5));
        }
        hub.cancel("c1");
        wait_idle(&hub);
        assert_eq!(meta_done(&l1), [true]);
        assert_eq!(
            kinds(&l1).last(),
            Some(&"done"),
            "the walk itself was not cancelled"
        );
        let books = cached_books(cache.path(), lib.path());
        let with = books.iter().filter(|b| b.meta.is_some()).count();
        assert!((1..20).contains(&with), "{with}");
        // the next scan reads the rest only
        let (s2, l2) = recorder();
        hub.open(cache.path(), "c1", target(lib.path()), s2);
        wait_idle(&hub);
        assert_eq!(meta_totals(&l2), [(20 - with) as u64]);
    }

    fn batched(log: &Log) -> usize {
        lock(log)
            .iter()
            .map(|e| match e {
                ScanEvent::Batch { books } => books.len(),
                _ => 0,
            })
            .sum()
    }

    #[test]
    fn first_scan_then_cached_with_diff() {
        let lib = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        touch(lib.path(), "a/Eins.cbz");
        touch(lib.path(), "Zwei.CBR");
        touch(lib.path(), "Drei.pdf");
        let hub = ScanHub::default();

        let (sink, log) = recorder();
        hub.open(cache.path(), "c1", target(lib.path()), sink);
        wait_idle(&hub);
        assert_eq!(kinds(&log), ["started", "batch", "done"]);
        assert_eq!(batched(&log), 2);
        assert_eq!(lock(&log)[0], ScanEvent::Started { first_scan: true });

        touch(lib.path(), "Vier.cbz");
        std::fs::remove_file(lib.path().join("Zwei.CBR")).unwrap();
        let (sink, log) = recorder();
        hub.open(cache.path(), "c1", target(lib.path()), sink);
        wait_idle(&hub);
        assert_eq!(kinds(&log), ["cached", "started", "diff", "done"]);
        let events = lock(&log);
        let ScanEvent::Cached { books, .. } = &events[0] else {
            panic!()
        };
        assert_eq!(books.len(), 2);
        let ScanEvent::Diff { added, removed, .. } = &events[2] else {
            panic!()
        };
        assert_eq!(added.len(), 1);
        assert_eq!(removed.len(), 1);
        // nothing was written into the comic folder
        let names: Vec<_> = std::fs::read_dir(lib.path()).unwrap().flatten().collect();
        assert_eq!(names.len(), 3);
    }

    fn entries(n: usize) -> Vec<BookEntry> {
        (0..n)
            .map(|i| {
                let p = format!("/lib/b{i}.cbz");
                BookEntry {
                    id: crate::scan::book_id(&p),
                    path: p,
                    rel_path: format!("b{i}.cbz"),
                    name: format!("b{i}.cbz"),
                    format: crate::model::BookFormat::Cbz,
                    size: 1,
                    modified_ms: None,
                    meta: None,
                }
            })
            .collect()
    }

    /// Design 004 (E2E): no message with more than MESSAGE_BOOKS books.
    #[test]
    fn large_caches_and_diffs_go_in_parts() {
        let stats = ScanStats::default();
        let small = cached_events(&entries(3), 7, &stats);
        assert!(matches!(
            &small[..],
            [ScanEvent::Cached { books, complete: true, scanned_at: 7, .. }] if books.len() == 3
        ));
        let empty = cached_events(&[], 7, &stats);
        assert!(matches!(
            &empty[..],
            [ScanEvent::Cached { complete: true, .. }]
        ));

        let big = cached_events(&entries(2 * MESSAGE_BOOKS + 5), 7, &stats);
        let sizes: Vec<(usize, bool)> = big
            .iter()
            .map(|e| match e {
                ScanEvent::Cached {
                    books, complete, ..
                }
                | ScanEvent::CachedMore { books, complete } => (books.len(), *complete),
                _ => panic!("{e:?}"),
            })
            .collect();
        assert_eq!(
            sizes,
            [(MESSAGE_BOOKS, false), (MESSAGE_BOOKS, false), (5, true)]
        );
        assert!(matches!(big[0], ScanEvent::Cached { .. }));

        assert_eq!(diff_events(entries(2), vec![], vec![]).len(), 1);
        let d = diff_events(entries(MESSAGE_BOOKS + 1), vec!["/x".into()], entries(3));
        let total: usize = d
            .iter()
            .map(|e| match e {
                ScanEvent::Diff {
                    added,
                    removed,
                    changed,
                } => {
                    let n = added.len() + removed.len() + changed.len();
                    assert!(n <= MESSAGE_BOOKS);
                    n
                }
                _ => panic!(),
            })
            .sum();
        assert_eq!(total, MESSAGE_BOOKS + 5);
    }

    #[test]
    fn a_large_cache_arrives_in_parts() {
        let lib = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        for i in 0..(MESSAGE_BOOKS + 10) {
            touch(lib.path(), &format!("d{}/Band {i}.cbz", i % 7));
        }
        let hub = ScanHub::default();
        let (sink, _) = recorder();
        hub.open(cache.path(), "c1", target(lib.path()), sink);
        wait_idle(&hub);
        let (sink, log) = recorder();
        hub.open(cache.path(), "c1", target(lib.path()), sink);
        wait_idle(&hub);
        assert_eq!(
            kinds(&log),
            ["cached", "cachedMore", "started", "diff", "done"]
        );
    }

    #[test]
    fn second_opener_joins_the_running_scan() {
        let lib = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        for i in 0..30 {
            touch(lib.path(), &format!("d{i}/Band {i}.cbz"));
        }
        let hub = ScanHub::with_options(4, Duration::from_millis(20));
        let (s1, l1) = recorder();
        let (s2, l2) = recorder();
        hub.open(cache.path(), "c1", target(lib.path()), s1);
        std::thread::sleep(Duration::from_millis(150));
        hub.open(cache.path(), "c2", target(lib.path()), s2);
        wait_idle(&hub);
        assert_eq!(hub.walks(), 1);
        assert_eq!(batched(&l1), 30);
        assert_eq!(
            batched(&l2),
            30,
            "the late opener gets every book exactly once"
        );
        assert_eq!(kinds(&l2).last(), Some(&"done"));
    }

    #[test]
    fn cancel_does_not_write_a_cache() {
        let lib = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        for i in 0..30 {
            touch(lib.path(), &format!("d{i}/b.cbz"));
        }
        let hub = ScanHub::with_options(4, Duration::from_millis(20));
        let (sink, log) = recorder();
        hub.open(cache.path(), "c1", target(lib.path()), sink);
        std::thread::sleep(Duration::from_millis(60));
        hub.cancel("c1");
        wait_idle(&hub);
        assert_eq!(kinds(&log).last(), Some(&"cancelled"));
        let t = target(lib.path());
        assert!(scan_cache::read(cache.path(), &t.base_dir, &t.extensions).is_none());
    }

    #[test]
    fn reopen_right_after_cancel_scans_again() {
        // review 002 #2: the new opener joined the cancelled scan and got `cancelled`
        let lib = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        for i in 0..30 {
            touch(lib.path(), &format!("d{i}/b.cbz"));
        }
        let hub = ScanHub::with_options(4, Duration::from_millis(20));
        let (s1, l1) = recorder();
        hub.open(cache.path(), "c1", target(lib.path()), s1);
        std::thread::sleep(Duration::from_millis(60));
        hub.cancel("c1");
        let (s2, l2) = recorder();
        hub.open(cache.path(), "c1", target(lib.path()), s2);
        wait_idle(&hub);
        assert_eq!(kinds(&l1).last(), Some(&"cancelled"));
        assert_eq!(kinds(&l2).last(), Some(&"done"));
        assert_eq!(batched(&l2), 30);
        assert_eq!(hub.walks(), 2);
    }

    #[test]
    fn a_panic_in_a_scan_does_not_block_the_target() {
        // review 002 #3: slot and map entry were never released
        let lib = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        touch(lib.path(), "b.cbz");
        let hub = ScanHub::with_options(1, Duration::ZERO);
        let boom: Sink = Arc::new(|e| {
            if matches!(e, ScanEvent::Batch { .. }) {
                panic!("sink failed");
            }
        });
        hub.open(cache.path(), "c1", target(lib.path()), boom);
        wait_idle(&hub);
        let (sink, log) = recorder();
        hub.open(cache.path(), "c1", target(lib.path()), sink);
        wait_idle(&hub);
        assert_eq!(kinds(&log).last(), Some(&"done"));
    }

    #[test]
    fn missing_folder_with_and_without_cache() {
        let lib = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        let root = lib.path().join("Laufwerk");
        touch(&root, "Band.cbz");
        let hub = ScanHub::default();
        let (sink, _) = recorder();
        hub.open(cache.path(), "c1", target(&root), sink);
        wait_idle(&hub);

        std::fs::rename(&root, lib.path().join("weg")).unwrap();
        let (sink, log) = recorder();
        hub.open(cache.path(), "c1", target(&root), sink);
        wait_idle(&hub);
        assert_eq!(kinds(&log), ["cached", "started", "failed"]);
        let last = lock(&log).last().cloned().unwrap();
        let ScanEvent::Failed { error, cache_kept } = last else {
            panic!()
        };
        assert_eq!(error.code, FsErrorCode::NotFound);
        assert!(cache_kept);
        // the cache survives the failure
        let t = target(&root);
        assert!(scan_cache::read(cache.path(), &t.base_dir, &t.extensions).is_some());

        let (sink, log) = recorder();
        hub.open(cache.path(), "c2", target(&lib.path().join("nie")), sink);
        wait_idle(&hub);
        let last = lock(&log).last().cloned().unwrap();
        assert!(matches!(
            last,
            ScanEvent::Failed {
                cache_kept: false,
                ..
            }
        ));
    }

    #[test]
    fn at_most_n_walks_at_once() {
        let cache = tempfile::tempdir().unwrap();
        let libs: Vec<_> = (0..3).map(|_| tempfile::tempdir().unwrap()).collect();
        for l in &libs {
            for i in 0..5 {
                touch(l.path(), &format!("d{i}/b.cbz"));
            }
        }
        let hub = ScanHub::with_options(1, Duration::from_millis(10));
        let logs: Vec<Log> = libs
            .iter()
            .enumerate()
            .map(|(i, l)| {
                let (s, log) = recorder();
                hub.open(cache.path(), &format!("c{i}"), target(l.path()), s);
                log
            })
            .collect();
        wait_idle(&hub);
        assert_eq!(hub.walks(), 3);
        for l in logs {
            assert_eq!(kinds(&l).last(), Some(&"done"));
        }
    }

    #[test]
    fn events_serialise_as_the_frontend_expects() {
        let e = serde_json::to_string(&ScanEvent::Started { first_scan: true }).unwrap();
        assert_eq!(e, r#"{"kind":"started","firstScan":true}"#);
        let e = serde_json::to_string(&ScanEvent::Cancelled).unwrap();
        assert_eq!(e, r#"{"kind":"cancelled"}"#);
        let e = serde_json::to_value(&ScanEvent::Done {
            scanned_at: 5,
            stats: ScanStats::default(),
        })
        .unwrap();
        assert_eq!(e["scannedAt"], 5);
        assert_eq!(e["stats"]["skippedDirLinks"], 0);
        let e = serde_json::to_string(&ScanEvent::Meta {
            items: vec![MetaItem {
                id: "00ff".into(),
                meta: BookMeta {
                    page_count: Some(3),
                    ..Default::default()
                },
            }],
        })
        .unwrap();
        assert_eq!(
            e,
            r#"{"kind":"meta","items":[{"id":"00ff","meta":{"pageCount":3}}]}"#
        );
        let e = serde_json::to_string(&ScanEvent::MetaProgress { done: 1, total: 2 }).unwrap();
        assert_eq!(e, r#"{"kind":"metaProgress","done":1,"total":2}"#);
        let e = serde_json::to_string(&ScanEvent::MetaDone { cancelled: false }).unwrap();
        assert_eq!(e, r#"{"kind":"metaDone","cancelled":false}"#);
    }

    /// Measurement for docs/architecture.md: `cargo test --release -- --ignored --nocapture measure`.
    #[test]
    #[ignore]
    fn measure_50000_books() {
        let lib = tempfile::tempdir().unwrap();
        let cache = tempfile::tempdir().unwrap();
        for d in 0..2500 {
            let dir = lib.path().join(format!("Serie {d}"));
            create_dir_all(&dir).unwrap();
            for b in 0..20 {
                File::create(dir.join(format!("Serie {d} Band {b:02} (Verlag 2020).cbr"))).unwrap();
            }
        }
        let t = target(lib.path());
        let started = Instant::now();
        let hub = ScanHub::default();
        let (sink, _) = recorder();
        hub.open(cache.path(), "m", t.clone(), sink);
        wait_idle(&hub);
        let first = started.elapsed();
        let started = Instant::now();
        let c = scan_cache::read(cache.path(), &t.base_dir, &t.extensions).unwrap();
        let read = started.elapsed();
        let started = Instant::now();
        let json = serde_json::to_string(&ScanEvent::Cached {
            books: c.books.clone(),
            scanned_at: 0,
            stats: c.stats.clone(),
            complete: true,
        })
        .unwrap();
        let ser = started.elapsed();
        let size = std::fs::metadata(scan_cache::cache_file(
            cache.path(),
            &scan_cache::cache_key(&t.base_dir, &t.extensions),
        ))
        .unwrap()
        .len();
        println!(
            "MEASURE books={} first_scan={first:?} cache_read={read:?} event_json={ser:?} ({} bytes) cache_file={size} bytes",
            c.books.len(),
            json.len()
        );
    }
}
