//! The cover pool (design 003 E9): a few worker threads, a **LIFO** queue (after fast scrolling
//! the covers asked for last – the visible ones – are made first), equal keys merged (a second
//! request for a cover in work waits for the same result), bounded: above `max_queue` waiting
//! jobs the oldest are dropped with `busy`. A panicking job is an error for its waiters only.

use crate::error::{FsError, FsErrorCode};
use std::collections::HashMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};

pub type Outcome = Result<Vec<u8>, FsError>;
pub type Job = Box<dyn FnOnce() -> Outcome + Send>;
pub type Waiter = Box<dyn FnOnce(Outcome) + Send>;

#[derive(Default)]
struct State {
    stack: Vec<(String, Job)>,
    /// Waiters of every key that is queued or running.
    waiters: HashMap<String, Vec<Waiter>>,
}

struct Inner {
    state: Mutex<State>,
    ready: Condvar,
    max_queue: usize,
}

#[derive(Clone)]
pub struct Pool {
    inner: Arc<Inner>,
}

fn lock(m: &Mutex<State>) -> MutexGuard<'_, State> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn busy() -> FsError {
    FsError::new(FsErrorCode::Busy, "too many covers waiting", None)
}

/// Threads for `cores` CPU cores: min(4, cores − 1), at least 1.
pub fn default_threads(cores: usize) -> usize {
    cores.saturating_sub(1).clamp(1, 4)
}

impl Pool {
    pub fn new(threads: usize, max_queue: usize) -> Self {
        let inner = Arc::new(Inner {
            state: Mutex::new(State::default()),
            ready: Condvar::new(),
            max_queue: max_queue.max(1),
        });
        for _ in 0..threads.max(1) {
            let inner = inner.clone();
            std::thread::spawn(move || work(&inner));
        }
        Self { inner }
    }

    /// Queues `job` under `key` (or joins a queued/running one); `waiter` gets the outcome.
    pub fn submit(&self, key: String, job: Job, waiter: Waiter) {
        let dropped = {
            let mut s = lock(&self.inner.state);
            if let Some(ws) = s.waiters.get_mut(&key) {
                ws.push(waiter);
                // asked for again: still queued → to the top, it is visible now (review 003 #7)
                if let Some(i) = s.stack.iter().position(|(k, _)| *k == key) {
                    let job = s.stack.remove(i);
                    s.stack.push(job);
                }
                return;
            }
            s.waiters.insert(key.clone(), vec![waiter]);
            s.stack.push((key, job));
            if s.stack.len() > self.inner.max_queue {
                let (old, _) = s.stack.remove(0);
                s.waiters.remove(&old).unwrap_or_default()
            } else {
                Vec::new()
            }
        };
        self.inner.ready.notify_one();
        for w in dropped {
            w(Err(busy()));
        }
    }

    /// Jobs waiting (not running) – for tests.
    pub fn queued(&self) -> usize {
        lock(&self.inner.state).stack.len()
    }
}

fn work(inner: &Inner) {
    loop {
        let (key, job) = {
            let mut s = lock(&inner.state);
            loop {
                if let Some(next) = s.stack.pop() {
                    break next;
                }
                s = inner.ready.wait(s).unwrap_or_else(|e| e.into_inner());
            }
        };
        let outcome = catch_unwind(AssertUnwindSafe(job))
            .unwrap_or_else(|_| Err(FsError::new(FsErrorCode::Io, "cover job failed", None)));
        let waiters = lock(&inner.state).waiters.remove(&key).unwrap_or_default();
        for w in waiters {
            let o = outcome.clone();
            let _ = catch_unwind(AssertUnwindSafe(move || w(o)));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    fn waiter(tx: &mpsc::Sender<(String, Outcome)>, name: &str) -> Waiter {
        let tx = tx.clone();
        let name = name.to_owned();
        Box::new(move |o| {
            let _ = tx.send((name, o));
        })
    }

    #[test]
    fn lifo_merging_and_panics() {
        let pool = Pool::new(1, 100);
        let (tx, rx) = mpsc::channel();
        let (gate_tx, gate_rx) = mpsc::channel::<()>();
        let gate = Mutex::new(Some(gate_rx));
        // the first job blocks the only worker until the others are queued
        pool.submit(
            "block".into(),
            Box::new(move || {
                let rx = gate.lock().unwrap().take().unwrap();
                rx.recv().unwrap();
                Ok(vec![0])
            }),
            waiter(&tx, "block"),
        );
        std::thread::sleep(Duration::from_millis(50));
        for k in ["a", "b", "c"] {
            let k2 = k.to_owned();
            pool.submit(
                k.into(),
                Box::new(move || Ok(k2.into_bytes())),
                waiter(&tx, k),
            );
        }
        // a second request for "b" joins the queued one and moves it to the top (review 003 #7)
        pool.submit(
            "b".into(),
            Box::new(|| panic!("never runs")),
            waiter(&tx, "b2"),
        );
        pool.submit("p".into(), Box::new(|| panic!("boom")), waiter(&tx, "p"));
        assert_eq!(pool.queued(), 4);
        gate_tx.send(()).unwrap();
        let order: Vec<(String, Outcome)> = (0..6)
            .map(|_| rx.recv_timeout(Duration::from_secs(5)).unwrap())
            .collect();
        let names: Vec<&str> = order.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, ["block", "p", "b", "b2", "c", "a"]);
        assert!(order[1].1.is_err(), "a panic is an error");
        assert_eq!(order[2].1.as_ref().unwrap(), b"b");
        assert_eq!(order[3].1.as_ref().unwrap(), b"b");
        // the pool still works after the panic
        pool.submit("z".into(), Box::new(|| Ok(vec![9])), waiter(&tx, "z"));
        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)).unwrap().1.unwrap(),
            vec![9]
        );
    }

    #[test]
    fn full_queue_drops_the_oldest_as_busy() {
        let pool = Pool::new(1, 2);
        let (tx, rx) = mpsc::channel();
        let (gate_tx, gate_rx) = mpsc::channel::<()>();
        let gate = Mutex::new(Some(gate_rx));
        pool.submit(
            "block".into(),
            Box::new(move || {
                let rx = gate.lock().unwrap().take().unwrap();
                rx.recv().unwrap();
                Ok(vec![])
            }),
            waiter(&tx, "block"),
        );
        std::thread::sleep(Duration::from_millis(50));
        for k in ["1", "2", "1", "3"] {
            pool.submit(k.into(), Box::new(|| Ok(vec![])), waiter(&tx, k));
        }
        // "1" was asked for again, so "2" is now the oldest
        let (name, outcome) = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(name, "2");
        assert_eq!(outcome.unwrap_err().code, FsErrorCode::Busy);
        gate_tx.send(()).unwrap();
    }

    #[test]
    fn thread_count() {
        assert_eq!(default_threads(1), 1);
        assert_eq!(default_threads(2), 1);
        assert_eq!(default_threads(4), 3);
        assert_eq!(default_threads(16), 4);
    }
}
