//! Running scans (design 002 E9): at most one scan per target (`baseDir` + extensions);
//! a second opener of the same target joins the running scan (like `runningScansPromises`
//! of the old app, legacy §3). Each scan runs on its own thread – never on the async
//! runtime –, at most [`MAX_PARALLEL`] at once.
//!
//! Event order for one opener:
//! - with cache:    `cached` → `started{firstScan:false}` → `progress`* → `diff` → `done`
//! - without cache: `started{firstScan:true}` → (`batch` | `progress`)* → `done`
//! - errors:        … → `failed{cacheKept}` | `cancelled`
//!
//! Pure Rust (no Tauri): events go to a [`Sink`]; the command layer wraps a `Channel`.

use crate::error::{FsError, FsErrorCode};
use crate::model::{BookEntry, ScanStats};
use crate::scan::{self, WalkEvent, WalkOptions};
use crate::scan_cache::{self, ScanCache};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const MAX_PARALLEL: usize = 4;
pub const BATCH_BOOKS: usize = 500;
pub const BATCH_INTERVAL: Duration = Duration::from_millis(50);
pub const PROGRESS_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ScanEvent {
    Cached {
        books: Vec<BookEntry>,
        scanned_at: i64,
        stats: ScanStats,
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
            deliver(
                &sink,
                ScanEvent::Cached {
                    books: c.books.clone(),
                    scanned_at: c.scanned_at,
                    stats: c.stats.clone(),
                },
            );
        }
        let mut map = lock(&self.inner.running);
        if let Some(r) = map.get_mut(&key) {
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
                deliver(&sink, ScanEvent::Batch { books });
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
    // leave the map first, then write the cache: a late opener either joined before (and gets
    // the diff against the old cache) or starts a scan of its own (review 002 #4)
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
                events.push(ScanEvent::Diff {
                    added: d.added,
                    removed: d.removed,
                    changed: d.changed,
                });
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
                ScanEvent::Started { .. } => "started",
                ScanEvent::Batch { .. } => "batch",
                ScanEvent::Progress { .. } => "progress",
                ScanEvent::Diff { .. } => "diff",
                ScanEvent::Done { .. } => "done",
                ScanEvent::Cancelled => "cancelled",
                ScanEvent::Failed { .. } => "failed",
            })
            .filter(|k| *k != "progress")
            .collect()
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
