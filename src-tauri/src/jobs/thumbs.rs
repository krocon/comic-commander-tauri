//! Missing covers of one or all categories (design 007, legacy §5): first count the missing
//! pairs (book × size, E4/E5), then make them on min(4, cores − 1) own threads with low decode
//! priority (E3), report at most ten times a second, list failures at the end. A cancelled run
//! leaves only whole cache files (`write_atomic`, 003) – the next run skips what is there.

use super::{Control, REPORT_EVERY, Reporter, lock};
use crate::categories::ThumbsDim;
use crate::cover::{CoverService, CoverState};
use crate::error::{FsError, FsErrorCode};
use crate::model::BookEntry;
use crate::{scan, scan_cache};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

pub const KIND: &str = "thumbs";
/// Failures listed at most.
pub const MAX_ERROR_LIST: usize = 1000;

/// One category to work on.
#[derive(Debug, Clone)]
pub struct Target {
    pub category_id: String,
    /// Shown in the error list instead of the folder (review 007 #5: no full user paths).
    pub title: String,
    pub base_dir: String,
    pub extensions: Vec<String>,
    pub dims: Vec<ThumbsDim>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadyBook {
    pub category_id: String,
    pub book_id: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbsProgress {
    pub total: usize,
    pub processed: usize,
    pub generated: usize,
    /// No image in the book (the old app's „skipped“).
    pub skipped: usize,
    pub errors: usize,
    pub current_file: Option<String>,
    pub elapsed_ms: u64,
    pub paused: bool,
    /// Finished since the last event (the grid draws them again, E6).
    pub ready: Vec<ReadyBook>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbError {
    /// `relPath` of the book (or the folder of a category that could not be read).
    pub name: String,
    pub code: FsErrorCode,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum JobEvent {
    Counting {
        found: usize,
        existing: usize,
    },
    Progress {
        progress: ThumbsProgress,
    },
    #[serde(rename_all = "camelCase")]
    Done {
        progress: ThumbsProgress,
        cancelled: bool,
        error_list: Vec<ThumbError>,
    },
    Failed {
        error: FsError,
    },
}

struct Item {
    category_id: String,
    book: BookEntry,
    dim: ThumbsDim,
}

struct State {
    progress: ThumbsProgress,
    error_list: Vec<ThumbError>,
    reporter: Reporter,
}

impl State {
    fn error(&mut self, name: String, code: FsErrorCode) {
        self.progress.errors += 1;
        if self.error_list.len() < MAX_ERROR_LIST {
            self.error_list.push(ThumbError { name, code });
        }
    }
}

/// The books of a category: the scan cache, else a fresh walk (cancellable, review 007 #4).
fn books_of(cache_dir: &Path, t: &Target, control: &Control) -> Result<Vec<BookEntry>, FsError> {
    if let Some(c) = scan_cache::read(cache_dir, &t.base_dir, &t.extensions) {
        return Ok(c.books);
    }
    let mut books = Vec::new();
    scan::walk(
        Path::new(&t.base_dir),
        &scan::WalkOptions::new(&t.extensions),
        control.cancel_flag(),
        &mut |e, _| {
            if let scan::WalkEvent::Book(b) = e {
                books.push(b);
            }
        },
    )?;
    Ok(books)
}

/// Runs the job (blocking); every event goes to `sink`.
pub fn run(
    targets: &[Target],
    cache_dir: &Path,
    covers: &CoverService,
    control: &Control,
    threads: usize,
    sink: &(dyn Fn(JobEvent) + Sync),
) {
    let mut state = State {
        progress: ThumbsProgress::default(),
        error_list: Vec::new(),
        reporter: Reporter::new(REPORT_EVERY),
    };
    // 1. count
    let mut work: Vec<Item> = Vec::new();
    let mut existing = 0;
    sink(JobEvent::Counting {
        found: 0,
        existing: 0,
    });
    for t in targets {
        let books = match books_of(cache_dir, t, control) {
            Ok(b) => b,
            Err(_) if control.cancelled() => return finish(state, control, sink),
            Err(e) => {
                state.error(t.title.clone(), e.code);
                continue;
            }
        };
        for book in books {
            for dim in &t.dims {
                if !control.wait_while_paused() {
                    return finish(state, control, sink);
                }
                match covers.state(Path::new(&book.path), dim) {
                    Ok(CoverState::Present) => existing += 1,
                    Ok(CoverState::Missing) => work.push(Item {
                        category_id: t.category_id.clone(),
                        book: book.clone(),
                        dim: dim.clone(),
                    }),
                    // gone since the last scan: nothing to do (review 007 #6)
                    Err(FsError {
                        code: FsErrorCode::NotFound,
                        ..
                    }) => {}
                    Ok(CoverState::Failed(code)) | Err(FsError { code, .. }) => {
                        // known already: counted, not opened again
                        state.progress.total += 1;
                        state.progress.processed += 1;
                        if code == FsErrorCode::NoImage {
                            state.progress.skipped += 1;
                        } else {
                            state.error(book.rel_path.clone(), code);
                        }
                    }
                }
                if state.reporter.due() {
                    sink(JobEvent::Counting {
                        found: work.len(),
                        existing,
                    });
                }
            }
        }
    }
    state.progress.total += work.len();
    state.progress.elapsed_ms = control.elapsed().as_millis() as u64;
    sink(JobEvent::Progress {
        progress: state.progress.clone(),
    });

    // 2. make them
    let next = AtomicUsize::new(0);
    let threads = threads.max(1);
    // workers still running – a drop guard counts a panicking one too (review 007 #1)
    let alive = AtomicUsize::new(threads);
    struct Exit<'a>(&'a AtomicUsize);
    impl Drop for Exit<'_> {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::SeqCst);
            crate::cover::image::set_low_priority(false);
        }
    }
    let shared = Mutex::new(state);
    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| {
                let _exit = Exit(&alive);
                crate::cover::image::set_low_priority(true);
                loop {
                    // nothing left: no waiting for a pause at 100 % (review 007 #9)
                    if next.load(Ordering::SeqCst) >= work.len() || !control.wait_while_paused() {
                        break;
                    }
                    let i = next.fetch_add(1, Ordering::SeqCst);
                    let Some(item) = work.get(i) else { break };
                    lock(&shared).progress.current_file = Some(item.book.rel_path.clone());
                    let path = PathBuf::from(&item.book.path);
                    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        covers.generate(&path, &item.dim, Some(control.cancel_flag()))
                    }))
                    .unwrap_or_else(|_| {
                        Err(FsError::new(
                            FsErrorCode::ArchiveError,
                            "cover failed (panic)",
                            None,
                        ))
                    });
                    let mut s = lock(&shared);
                    // cancelled in the middle: not counted (the run is over anyway)
                    if control.cancelled() && outcome.is_err() {
                        break;
                    }
                    s.progress.processed += 1;
                    match outcome {
                        Ok(()) => {
                            s.progress.generated += 1;
                            let ready = ReadyBook {
                                category_id: item.category_id.clone(),
                                book_id: item.book.id.clone(),
                            };
                            if !s.progress.ready.contains(&ready) {
                                s.progress.ready.push(ready);
                            }
                        }
                        Err(e) if e.code == FsErrorCode::NoImage => s.progress.skipped += 1,
                        Err(e) => s.error(item.book.rel_path.clone(), e.code),
                    }
                    if s.reporter.due() {
                        s.progress.elapsed_ms = control.elapsed().as_millis() as u64;
                        s.progress.paused = control.paused();
                        let progress = s.progress.clone();
                        s.progress.ready.clear();
                        sink(JobEvent::Progress { progress });
                    }
                }
            });
        }
        // a paused run still tells that it is paused
        scope.spawn(|| {
            let mut was = false;
            while alive.load(Ordering::SeqCst) > 0 && !control.cancelled() {
                let now = control.paused();
                if now != was {
                    was = now;
                    let mut s = lock(&shared);
                    s.progress.paused = now;
                    s.progress.elapsed_ms = control.elapsed().as_millis() as u64;
                    let progress = s.progress.clone();
                    s.progress.ready.clear();
                    sink(JobEvent::Progress { progress });
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        });
    });
    let state = shared.into_inner().unwrap_or_else(|e| e.into_inner());
    // the covers of this run are in; trim once now (review 007 #2)
    covers.trim_cache();
    finish(state, control, sink);
}

fn finish(mut state: State, control: &Control, sink: &(dyn Fn(JobEvent) + Sync)) {
    state.progress.current_file = None;
    state.progress.paused = false;
    state.progress.elapsed_ms = control.elapsed().as_millis() as u64;
    sink(JobEvent::Done {
        progress: state.progress,
        cancelled: control.cancelled(),
        error_list: state.error_list,
    });
}

#[cfg(test)]
mod tests;
