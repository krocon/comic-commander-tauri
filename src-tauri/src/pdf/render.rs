//! Render threads for PDF pages (design 006 E3): hayro is pure Rust (no FFI), so no helper
//! process – but it cannot be cancelled and deep nesting needs stack. Pages are rendered on
//! [`THREADS`] own threads with [`STACK`] bytes of stack inside `catch_unwind`; the caller waits
//! at most its time limit (`timeout` – the thread finishes the page and is free again). More
//! than [`MAX_QUEUE`] waiting pages → `busy`.

use crate::error::{FsError, FsErrorCode};
use std::collections::VecDeque;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::sync::{Condvar, Mutex, OnceLock};
use std::time::Duration;

pub const THREADS: usize = 2;
pub const STACK: usize = 64 << 20;
pub const MAX_QUEUE: usize = 16;

type Job = Box<dyn FnOnce() + Send>;

struct Queue {
    /// (normal, low priority) – background work never takes both threads (review 007 #3).
    jobs: Mutex<(VecDeque<Job>, VecDeque<Job>, usize)>,
    ready: Condvar,
    workers: AtomicUsize,
}

fn queue() -> &'static Queue {
    static Q: OnceLock<Queue> = OnceLock::new();
    let q = Q.get_or_init(|| Queue {
        jobs: Mutex::new((VecDeque::new(), VecDeque::new(), 0)),
        ready: Condvar::new(),
        workers: AtomicUsize::new(0),
    });
    static STARTED: OnceLock<()> = OnceLock::new();
    STARTED.get_or_init(|| {
        for i in 0..THREADS {
            let started = std::thread::Builder::new()
                .name(format!("pdf-render-{i}"))
                .stack_size(STACK)
                .spawn(work);
            if started.is_ok() {
                q.workers.fetch_add(1, Ordering::SeqCst);
            }
        }
    });
    q
}

fn work() {
    let q = queue();
    loop {
        let (job, low) = {
            let mut jobs = q.jobs.lock().unwrap_or_else(|e| e.into_inner());
            loop {
                if let Some(j) = jobs.0.pop_front() {
                    break (j, false);
                }
                // at most one background page at a time: the other thread stays for the user
                if jobs.2 == 0
                    && let Some(j) = jobs.1.pop_front()
                {
                    jobs.2 += 1;
                    break (j, true);
                }
                jobs = q.ready.wait(jobs).unwrap_or_else(|e| e.into_inner());
            }
        };
        job();
        if low {
            q.jobs.lock().unwrap_or_else(|e| e.into_inner()).2 -= 1;
            q.ready.notify_all();
        }
    }
}

/// Runs `f` on a render thread and waits at most `limit` for its result.
pub fn run<T: Send + 'static>(
    limit: Duration,
    f: impl FnOnce() -> Result<T, FsError> + Send + 'static,
) -> Result<T, FsError> {
    // background pages wait behind each other (one at a time): more patience
    let limit = if crate::cover::image::low_priority() {
        limit * 6
    } else {
        limit
    };
    let (tx, rx) = mpsc::channel();
    // set when the caller gave up: a job not started yet is dropped with its book (review 006 #3)
    let abandoned = Arc::new(AtomicBool::new(false));
    let gone = abandoned.clone();
    let job: Job = Box::new(move || {
        if gone.load(Ordering::SeqCst) {
            return;
        }
        let outcome = catch_unwind(AssertUnwindSafe(f)).unwrap_or_else(|_| {
            Err(FsError::new(
                FsErrorCode::ArchiveError,
                "the PDF page cannot be rendered (renderer failure)",
                None,
            ))
        });
        let _ = tx.send(outcome);
    });
    {
        let q = queue();
        if q.workers.load(Ordering::SeqCst) == 0 {
            return Err(FsError::new(FsErrorCode::Io, "no PDF render thread", None));
        }
        let mut jobs = q.jobs.lock().unwrap_or_else(|e| e.into_inner());
        if crate::cover::image::low_priority() {
            // bounded by the job's own threads
            jobs.1.push_back(job);
            q.ready.notify_all();
        } else if jobs.0.len() >= MAX_QUEUE {
            return Err(FsError::new(
                FsErrorCode::Busy,
                "too many PDF pages waiting",
                None,
            ));
        } else {
            jobs.0.push_back(job);
            q.ready.notify_all();
        }
    }
    match rx.recv_timeout(limit) {
        Ok(outcome) => outcome,
        Err(_) => {
            abandoned.store(true, Ordering::SeqCst);
            Err(FsError::new(
                FsErrorCode::Timeout,
                "rendering the PDF page took too long",
                None,
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn results_panics_and_time_limits() {
        assert_eq!(run(Duration::from_secs(5), || Ok(7)).unwrap(), 7);
        let panicked = run::<()>(Duration::from_secs(5), || panic!("boom")).unwrap_err();
        assert_eq!(panicked.code, FsErrorCode::ArchiveError);
        let slow = run(Duration::from_millis(20), || {
            std::thread::sleep(Duration::from_millis(300));
            Ok(())
        })
        .unwrap_err();
        assert_eq!(slow.code, FsErrorCode::Timeout);
        // deep recursion fits into the big stack
        fn deep(n: u32) -> u32 {
            let pad = std::hint::black_box([n as u8; 512]);
            if n == 0 {
                0
            } else {
                deep(n - 1) + u32::from(pad[1] == 1 && n == u32::MAX)
            }
        }
        assert_eq!(
            run(Duration::from_secs(10), || Ok(deep(50_000))).unwrap(),
            0
        );
    }

    #[test]
    fn background_pages_leave_a_thread_for_the_user() {
        // review 007 #3: one background page at a time, normal pages pass it
        use std::time::Instant;
        let slow = std::thread::spawn(|| {
            crate::cover::image::set_low_priority(true);
            run(Duration::from_secs(10), || {
                std::thread::sleep(Duration::from_millis(400));
                Ok(Instant::now())
            })
            .unwrap()
        });
        std::thread::sleep(Duration::from_millis(50));
        let second = std::thread::spawn(|| {
            crate::cover::image::set_low_priority(true);
            run(Duration::from_secs(10), || Ok(Instant::now())).unwrap()
        });
        std::thread::sleep(Duration::from_millis(50));
        let t = Instant::now();
        run(Duration::from_secs(5), || Ok(())).unwrap();
        assert!(
            t.elapsed() < Duration::from_millis(300),
            "{:?}",
            t.elapsed()
        );
        let (a, b) = (slow.join().unwrap(), second.join().unwrap());
        assert!(b >= a, "the second background page waited for the first");
    }
}
