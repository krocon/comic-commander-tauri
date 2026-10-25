use super::*;
use crate::book::tests::build;
use std::sync::Arc;
use std::time::{Duration, Instant};

fn dims() -> Vec<ThumbsDim> {
    vec![
        ThumbsDim {
            width: 100,
            height: 150,
            name_extension: String::new(),
        },
        ThumbsDim {
            width: 200,
            height: 300,
            name_extension: "_xl".into(),
        },
    ]
}

struct Lib {
    _root: tempfile::TempDir,
    cache: tempfile::TempDir,
    target: Target,
    covers: Arc<CoverService>,
}

fn lib(good: usize) -> Lib {
    let root = tempfile::tempdir().unwrap();
    let base = root.path().join("Comics ä 🦸");
    std::fs::create_dir_all(base.join("Hägar")).unwrap();
    for i in 0..good {
        build::cbz(
            &base.join(format!("Hägar/Hägar {i:03}.cbz")),
            &[("001.jpg", build::jpeg(60, 90, i as u32))],
        );
    }
    build::cbz(&base.join("Nur Text.cbz"), &[("a.txt", b"hallo".to_vec())]);
    std::fs::write(base.join("kaputt.cbz"), b"PK\x03\x04 nothing").unwrap();
    // a sidecar of the old app for one size of the first book
    if good > 0 {
        std::fs::write(base.join("Hägar/Hägar 000.jpg"), build::jpeg(10, 15, 1)).unwrap();
    }
    let cache = tempfile::tempdir().unwrap();
    let covers = CoverService::new(cache.path(), 1);
    Lib {
        target: Target {
            category_id: "c0000000000a1".into(),
            title: "Comics".into(),
            base_dir: base.to_string_lossy().into_owned(),
            extensions: vec![".cbz".into()],
            dims: dims(),
        },
        _root: root,
        cache,
        covers,
    }
}

fn run_job(l: &Lib, control: &Control) -> Vec<JobEvent> {
    let events = Mutex::new(Vec::new());
    run(
        std::slice::from_ref(&l.target),
        l.cache.path(),
        &l.covers,
        control,
        3,
        &|e| lock(&events).push(e),
    );
    events.into_inner().unwrap()
}

fn done(events: &[JobEvent]) -> (ThumbsProgress, bool, Vec<ThumbError>) {
    match events.last() {
        Some(JobEvent::Done {
            progress,
            cancelled,
            error_list,
        }) => (progress.clone(), *cancelled, error_list.clone()),
        other => panic!("no done: {other:?}"),
    }
}

fn cover_files(cache: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for sub in std::fs::read_dir(cache.join("covers"))
        .into_iter()
        .flatten()
        .flatten()
    {
        for f in std::fs::read_dir(sub.path())
            .into_iter()
            .flatten()
            .flatten()
        {
            out.push(f.path());
        }
    }
    out
}

#[test]
fn counts_skips_makes_and_lists_failures() {
    let l = lib(5);
    let events = run_job(&l, &Control::default());
    assert!(matches!(events[0], JobEvent::Counting { .. }));
    let (p, cancelled, errors) = done(&events);
    assert!(!cancelled);
    // 7 books × 2 sizes, one sidecar present
    assert_eq!(p.total, 13);
    assert_eq!(p.processed, 13);
    assert_eq!(p.generated, 9);
    assert_eq!(p.skipped, 2);
    assert_eq!(p.errors, 2);
    assert_eq!(errors.len(), 2);
    assert!(
        errors
            .iter()
            .all(|e| e.name == "kaputt.cbz" && e.code == FsErrorCode::ArchiveError)
    );
    assert_eq!(cover_files(l.cache.path()).len(), 9);
    // the grid hears about every book made (once per event)
    let ready: Vec<ReadyBook> = events
        .iter()
        .flat_map(|e| match e {
            JobEvent::Progress { progress } | JobEvent::Done { progress, .. } => {
                progress.ready.clone()
            }
            _ => vec![],
        })
        .collect();
    assert!(ready.len() >= 5);

    // again: nothing is opened, remembered failures are counted without work
    let (p, _, errors) = done(&run_job(&l, &Control::default()));
    assert_eq!((p.total, p.generated, p.skipped, p.errors), (4, 0, 2, 2));
    assert_eq!(errors.len(), 2);
}

#[test]
fn cancel_leaves_whole_files_and_a_new_run_goes_on() {
    let l = lib(60);
    let control = Arc::new(Control::default());
    let c = control.clone();
    // cancel as soon as the first cover exists
    let cache = l.cache.path().to_path_buf();
    let watcher = std::thread::spawn(move || {
        let until = Instant::now() + Duration::from_secs(30);
        while cover_files(&cache).is_empty() && Instant::now() < until {
            std::thread::sleep(Duration::from_millis(2));
        }
        c.cancel();
    });
    let (p, cancelled, _) = done(&run_job(&l, &control));
    watcher.join().unwrap();
    assert!(cancelled);
    assert!(p.processed < p.total, "{p:?}");
    let files = cover_files(l.cache.path());
    for f in &files {
        assert_eq!(f.extension().unwrap(), "jpg", "{f:?}");
        image::load_from_memory(&std::fs::read(f).unwrap()).unwrap();
    }
    // the next run skips what is there and makes the rest
    let (p2, cancelled, _) = done(&run_job(&l, &Control::default()));
    assert!(!cancelled);
    assert_eq!(p2.generated + files.len(), 60 * 2 - 1);
}

#[test]
fn pause_holds_the_run() {
    let l = lib(4);
    let control = Arc::new(Control::default());
    control.set_paused(true);
    let c = control.clone();
    let cache = l.cache.path().to_path_buf();
    let t = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        let made = cover_files(&cache).len();
        c.set_paused(false);
        made
    });
    let started = std::time::Instant::now();
    let events = run_job(&l, &control);
    let wall_ms = started.elapsed().as_millis() as u64;
    assert_eq!(t.join().unwrap(), 0, "covers made while paused");
    let (p, _, _) = done(&events);
    assert_eq!(p.generated, 7);
    // paused before the start: counting waits too (review 007 #4), nothing was made – and the
    // 300 ms pause is not part of the elapsed time (compared with the wall clock: CI runners are
    // too slow for a fixed bound on the work itself)
    assert!(p.elapsed_ms + 250 <= wall_ms, "elapsed {} ms, wall {wall_ms} ms", p.elapsed_ms);
}

#[test]
fn an_unreadable_category_is_an_error_entry() {
    let mut l = lib(1);
    l.target.base_dir = "/does/not/exist/Comics".into();
    let (p, cancelled, errors) = done(&run_job(&l, &Control::default()));
    assert!(!cancelled);
    assert_eq!((p.total, p.errors), (0, 1));
    // the title, not the folder (review 007 #5)
    assert_eq!(errors[0].name, "Comics");
}
