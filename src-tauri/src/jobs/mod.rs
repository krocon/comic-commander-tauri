//! Long work in the background (design 007 E1): a slim job engine – at most **one run per
//! kind** ([`JobHub`]), a [`Control`] for cancel and pause (time without pauses), a
//! [`Reporter`] that lets at most ten progress events per second through. Kinds so far:
//! [`thumbs`] (missing covers); duplicates (010) and clearing caches can join.

pub mod thumbs;

use crate::error::{FsError, FsErrorCode};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Cancel and pause of one run.
pub struct Control {
    cancel: AtomicBool,
    /// (paused, time paused so far, paused since)
    pause: Mutex<(bool, Duration, Option<Instant>)>,
    changed: Condvar,
    started: Instant,
}

impl Default for Control {
    fn default() -> Self {
        Self {
            cancel: AtomicBool::new(false),
            pause: Mutex::new((false, Duration::ZERO, None)),
            changed: Condvar::new(),
            started: Instant::now(),
        }
    }
}

impl Control {
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
        let _g = lock(&self.pause);
        self.changed.notify_all();
    }

    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }

    /// The flag for the budgets of `book::` (cancel reaches a running cover).
    pub fn cancel_flag(&self) -> &AtomicBool {
        &self.cancel
    }

    pub fn set_paused(&self, paused: bool) {
        let mut p = lock(&self.pause);
        if paused == p.0 {
            return;
        }
        if paused {
            p.2 = Some(Instant::now());
        } else if let Some(since) = p.2.take() {
            p.1 += since.elapsed();
        }
        p.0 = paused;
        self.changed.notify_all();
    }

    pub fn paused(&self) -> bool {
        lock(&self.pause).0
    }

    /// Blocks while paused; `false` = cancelled, stop.
    pub fn wait_while_paused(&self) -> bool {
        let mut p = lock(&self.pause);
        while p.0 && !self.cancelled() {
            p = self.changed.wait(p).unwrap_or_else(|e| e.into_inner());
        }
        !self.cancelled()
    }

    /// Time the run worked (pauses not counted).
    pub fn elapsed(&self) -> Duration {
        let p = lock(&self.pause);
        let paused = p.1 + p.2.map_or(Duration::ZERO, |s| s.elapsed());
        self.started.elapsed().saturating_sub(paused)
    }
}

/// Lets an event through at most every `interval`; the last state is sent by the caller at the
/// end (`done`), so nothing is lost.
pub struct Reporter {
    interval: Duration,
    last: Option<Instant>,
}

/// At most ten progress events per second (design 007, Anforderung 3).
pub const REPORT_EVERY: Duration = Duration::from_millis(100);

impl Reporter {
    pub fn new(interval: Duration) -> Self {
        Self {
            interval,
            last: None,
        }
    }

    /// `true` when an event may go out now.
    pub fn due(&mut self) -> bool {
        let now = Instant::now();
        if self
            .last
            .is_some_and(|l| now.duration_since(l) < self.interval)
        {
            return false;
        }
        self.last = Some(now);
        true
    }
}

/// Kind → (id, control) of the running jobs.
type RunningMap = Arc<Mutex<HashMap<&'static str, (String, Arc<Control>)>>>;

/// The running jobs, one per kind.
#[derive(Default)]
pub struct JobHub {
    running: RunningMap,
    next: AtomicU64,
}

/// Keeps a run registered; dropping it (end of the run, also on panic) frees the kind.
pub struct Running {
    running: RunningMap,
    kind: &'static str,
    pub id: String,
    pub control: Arc<Control>,
}

impl Drop for Running {
    fn drop(&mut self) {
        let mut r = lock(&self.running);
        if r.get(self.kind).is_some_and(|(id, _)| *id == self.id) {
            r.remove(self.kind);
        }
    }
}

impl JobHub {
    /// Registers a run of `kind`; `job_running` when one is running already.
    pub fn start(&self, kind: &'static str) -> Result<Running, FsError> {
        let mut r = lock(&self.running);
        if r.contains_key(kind) {
            return Err(FsError::new(
                FsErrorCode::JobRunning,
                format!("a {kind} job is running already"),
                None,
            ));
        }
        let id = format!("{kind}-{}", self.next.fetch_add(1, Ordering::Relaxed) + 1);
        let control = Arc::new(Control::default());
        r.insert(kind, (id.clone(), control.clone()));
        Ok(Running {
            running: self.running.clone(),
            kind,
            id,
            control,
        })
    }

    pub fn control(&self, id: &str) -> Option<Arc<Control>> {
        lock(&self.running)
            .values()
            .find(|(i, _)| i == id)
            .map(|(_, c)| c.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_run_per_kind() {
        let hub = JobHub::default();
        let a = hub.start("thumbs").unwrap();
        assert_eq!(
            hub.start("thumbs").err().map(|e| e.code),
            Some(FsErrorCode::JobRunning)
        );
        assert!(hub.start("other").is_ok());
        assert!(hub.control(&a.id).is_some());
        let id = a.id.clone();
        drop(a);
        assert!(hub.control(&id).is_none());
        let b = hub.start("thumbs").unwrap();
        assert_ne!(b.id, id);
    }

    #[test]
    fn pause_blocks_and_does_not_count_as_time() {
        let c = Arc::new(Control::default());
        c.set_paused(true);
        let c2 = c.clone();
        let t = std::thread::spawn(move || c2.wait_while_paused());
        std::thread::sleep(Duration::from_millis(150));
        assert!(!t.is_finished());
        c.set_paused(false);
        assert!(t.join().unwrap());
        assert!(
            c.elapsed() < Duration::from_millis(100),
            "{:?}",
            c.elapsed()
        );
        // cancel wakes a paused worker
        c.set_paused(true);
        let c3 = c.clone();
        let t = std::thread::spawn(move || c3.wait_while_paused());
        std::thread::sleep(Duration::from_millis(50));
        c.cancel();
        assert!(!t.join().unwrap());
    }

    #[test]
    fn reporter_throttles() {
        let mut r = Reporter::new(Duration::from_millis(100));
        assert!(r.due());
        assert!(!r.due());
        std::thread::sleep(Duration::from_millis(110));
        assert!(r.due());
        let mut count = 0;
        let start = Instant::now();
        while start.elapsed() < Duration::from_millis(500) {
            if r.due() {
                count += 1;
            }
        }
        assert!(count <= 6, "{count}");
    }
}
