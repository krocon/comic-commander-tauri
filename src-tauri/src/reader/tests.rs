use super::*;
use crate::book::tests::build;
use std::io::Cursor;

fn webp(w: u32, h: u32) -> Vec<u8> {
    let img = ::image::ImageBuffer::from_pixel(w, h, ::image::Rgba([200u8, 10, 30, 255]));
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, ::image::ImageFormat::WebP).unwrap();
    out.into_inner()
}

/// Pages in a mixed order with junk around them.
fn book_pages() -> Vec<(&'static str, Vec<u8>)> {
    vec![
        ("Hägar 🦸/Seite 10.jpg", build::jpeg(40, 60, 10)),
        ("Hägar 🦸/Seite 2.png", build::png(30, 45)),
        ("__MACOSX/Hägar 🦸/._Seite 1.jpg", b"junk".to_vec()),
        ("Hägar 🦸/ComicInfo.xml", b"<ComicInfo/>".to_vec()),
        ("Hägar 🦸/Seite 1.jpg", build::jpeg(40, 60, 1)),
        ("Hägar 🦸/Seite 3.webp", webp(20, 30)),
    ]
}

const ORDER: [&str; 4] = [
    "Hägar 🦸/Seite 1.jpg",
    "Hägar 🦸/Seite 2.png",
    "Hägar 🦸/Seite 3.webp",
    "Hägar 🦸/Seite 10.jpg",
];

fn bytes_of(name: &str) -> Vec<u8> {
    book_pages().into_iter().find(|p| p.0 == name).unwrap().1
}

#[derive(Clone, Default)]
struct Events(Arc<Mutex<Vec<ReaderEvent>>>);

impl Events {
    fn sink(&self) -> Sink {
        let me = self.0.clone();
        Arc::new(move |e| lock(&me).push(e))
    }

    /// Waits for `done` / `failed`.
    fn wait_end(&self) -> Vec<ReaderEvent> {
        let until = Instant::now() + Duration::from_secs(20);
        loop {
            let ev = lock(&self.0).clone();
            if ev
                .iter()
                .any(|e| matches!(e, ReaderEvent::Done | ReaderEvent::Failed { .. }))
            {
                return ev;
            }
            assert!(Instant::now() < until, "no end event: {ev:?}");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn dims(&self) -> HashMap<usize, (u32, u32)> {
        lock(&self.0)
            .iter()
            .flat_map(|e| match e {
                ReaderEvent::Dims { pages } => pages.clone(),
                _ => vec![],
            })
            .map(|d| (d.index, (d.width, d.height)))
            .collect()
    }
}

fn page(service: &ReaderService, token: &str, index: usize, width: u32) -> Reply {
    service.serve(&PageRequest {
        token: token.into(),
        index,
        width,
    })
}

fn expected_dims() -> HashMap<usize, (u32, u32)> {
    [(0, (40, 60)), (1, (30, 45)), (2, (20, 30)), (3, (40, 60))].into()
}

#[test]
fn direct_books_serve_pages_in_natural_order() {
    let d = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let service = ReaderService::new(cache.path(), page_cache::DEFAULT_LIMIT);
    let z = d.path().join("Hägar 01.cbr"); // a ZIP named .cbr
    build::cbz(&z, &book_pages());
    let t = d.path().join("Hägar 01.cbt");
    build::cbt(&t, &book_pages());
    let r = d.path().join("Hägar 01 rar.cbr");
    build::cbr4(&r, &book_pages());
    for book in [z, t, r] {
        let events = Events::default();
        let opened = service.open(&book, events.sink()).unwrap();
        assert!(!opened.extracting);
        assert_eq!(opened.token.len(), 16);
        let names: Vec<&str> = opened.pages.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ORDER, "{book:?}");
        for (i, name) in ORDER.iter().enumerate() {
            let reply = page(&service, &opened.token, i, 0);
            assert_eq!(reply.status, 200, "{book:?} {name}");
            assert_eq!(reply.body, bytes_of(name));
        }
        assert_eq!(page(&service, &opened.token, 2, 0).mime, "image/webp");
        assert_eq!(page(&service, &opened.token, 4, 0).status, 404);
        let ev = events.wait_end();
        assert!(ev.contains(&ReaderEvent::Done), "{ev:?}");
        if book.extension().unwrap() == "cbt" || book.to_string_lossy().ends_with("01.cbr") {
            assert_eq!(events.dims(), expected_dims(), "{book:?}");
        }
        service.close(&opened.token);
        assert_eq!(page(&service, &opened.token, 0, 0).status, 404);
    }
    assert_eq!(page(&service, "0123456789abcdef", 0, 0).status, 404);
}

#[test]
fn solid_books_are_unpacked_once_into_the_cache() {
    let d = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let service = ReaderService::new(cache.path(), page_cache::DEFAULT_LIMIT);
    let book = d.path().join("Hägar 🦸 solid.cb7");
    build::cb7(&book, &book_pages(), true);
    let events = Events::default();
    let opened = service.open(&book, events.sink()).unwrap();
    assert!(opened.extracting);
    // the last page first: waits for the unpacking
    let reply = page(&service, &opened.token, 3, 0);
    assert_eq!(reply.status, 200);
    assert_eq!(reply.body, bytes_of(ORDER[3]));
    assert!(events.wait_end().contains(&ReaderEvent::Done));
    assert_eq!(events.dims(), expected_dims());
    let pages_dir = cache.path().join(page_cache::DIR_NAME);
    assert_eq!(std::fs::read_dir(&pages_dir).unwrap().count(), 1);
    service.close(&opened.token);

    // again: from the cache, sizes known at once, nothing unpacked again
    let events = Events::default();
    let again = service.open(&book, events.sink()).unwrap();
    assert_eq!(again.pages[1].width, Some(30));
    assert_eq!(again.pages[1].height, Some(45));
    assert_ne!(again.token, opened.token);
    for (i, name) in ORDER.iter().enumerate() {
        assert_eq!(page(&service, &again.token, i, 0).body, bytes_of(name));
    }
    assert!(events.wait_end().contains(&ReaderEvent::Done));
    assert!(events.dims().is_empty());
}

#[test]
fn closing_cancels_the_unpacking() {
    let d = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let service = ReaderService::new(cache.path(), page_cache::DEFAULT_LIMIT);
    let pages: Vec<(String, Vec<u8>)> = (0..300)
        .map(|i| (format!("p{i:03}.jpg"), build::jpeg(300, 400, i)))
        .collect();
    let refs: Vec<(&str, Vec<u8>)> = pages.iter().map(|(n, d)| (n.as_str(), d.clone())).collect();
    let book = d.path().join("big.cb7");
    build::cb7(&book, &refs, true);
    let events = Events::default();
    let opened = service.open(&book, events.sink()).unwrap();
    service.close(&opened.token);
    // the pass ends without done/failed; the page cache keeps no complete marker
    let until = Instant::now() + Duration::from_secs(20);
    let session_dir = || {
        std::fs::read_dir(cache.path().join(page_cache::DIR_NAME))
            .ok()
            .and_then(|mut r| r.next())
            .and_then(|e| e.ok())
            .map(|e| e.path())
    };
    std::thread::sleep(Duration::from_millis(300));
    while Instant::now() < until && lock(&events.0).is_empty() {
        std::thread::sleep(Duration::from_millis(20));
        if session_dir().is_some() {
            break;
        }
    }
    std::thread::sleep(Duration::from_millis(500));
    assert!(
        !lock(&events.0)
            .iter()
            .any(|e| matches!(e, ReaderEvent::Done | ReaderEvent::Failed { .. }))
    );
    if let Some(dir) = session_dir() {
        assert!(!dir.join("complete.json").exists());
        assert!(std::fs::read_dir(&dir).unwrap().count() < 300);
    }
}

#[test]
fn hostile_pages_are_not_served_as_they_are() {
    let d = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let service = ReaderService::new(cache.path(), page_cache::DEFAULT_LIMIT);
    let book = d.path().join("evil.cbz");
    build::cbz(
        &book,
        &[
            ("1.jpg", b"<html><script>alert(1)</script></html>".to_vec()),
            ("2.jpg", b"\xff\xd8\xff broken".to_vec()),
            ("3.png", build::png(4000, 100)),
        ],
    );
    let opened = service.open(&book, Events::default().sink()).unwrap();
    assert_eq!(page(&service, &opened.token, 0, 0).status, 415);
    assert_eq!(page(&service, &opened.token, 1, 0).status, 422);
    // wide page, window needs 1024: scaled
    let scaled = page(&service, &opened.token, 2, 1024);
    assert_eq!((scaled.status, scaled.mime), (200, "image/jpeg"));
    assert_eq!(image::dimensions(&scaled.body), Some((1024, 26)));
}

#[test]
fn books_that_cannot_be_read() {
    let d = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let service = ReaderService::new(cache.path(), page_cache::DEFAULT_LIMIT);
    let pdf = d.path().join("a.pdf");
    std::fs::write(&pdf, b"%PDF-1.7\n...").unwrap();
    let code = |p: &Path| service.open(p, Events::default().sink()).unwrap_err().code;
    // design 006: a broken PDF is broken, not unsupported
    assert_eq!(code(&pdf), FsErrorCode::ArchiveError);
    let text = d.path().join("text.cbz");
    build::cbz(&text, &[("a.txt", b"hallo".to_vec())]);
    assert_eq!(code(&text), FsErrorCode::NoImage);
    assert_eq!(code(&d.path().join("missing.cbz")), FsErrorCode::NotFound);
}

#[test]
fn oldest_book_is_closed_beyond_the_limit() {
    let d = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let service = ReaderService::new(cache.path(), page_cache::DEFAULT_LIMIT);
    let book = d.path().join("a.cbz");
    build::cbz(&book, &[("1.jpg", build::jpeg(10, 10, 1))]);
    let tokens: Vec<String> = (0..=MAX_SESSIONS)
        .map(|_| service.open(&book, Events::default().sink()).unwrap().token)
        .collect();
    assert_eq!(page(&service, &tokens[0], 0, 0).status, 404);
    assert_eq!(page(&service, &tokens[MAX_SESSIONS], 0, 0).status, 200);
}

#[test]
fn gate_refuses_when_too_many_wait() {
    let gate = Arc::new(Gate {
        state: Mutex::new((0, 0)),
        freed: Condvar::new(),
    });
    let held: Vec<GatePass<'_>> = (0..MAX_WORKING).map(|_| gate.enter().unwrap()).collect();
    let mut waiters = Vec::new();
    for _ in 0..MAX_WAITING {
        let g = gate.clone();
        waiters.push(std::thread::spawn(move || g.enter().is_some()));
    }
    let until = Instant::now() + Duration::from_secs(10);
    while lock(&gate.state).1 < MAX_WAITING {
        assert!(Instant::now() < until);
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(gate.enter().is_none());
    drop(held);
    for w in waiters {
        assert!(w.join().unwrap());
    }
}

#[test]
fn memory_cache_is_bounded() {
    let mut m = Memory::default();
    let big = Arc::new(vec![0u8; MEMORY_CACHE / 5]);
    for i in 0..10 {
        m.put(("t".into(), i, 0), big.clone(), "image/jpeg");
    }
    assert!(m.bytes <= MEMORY_CACHE);
    assert!(m.get(&("t".into(), 9, 0)).is_some());
    assert!(m.get(&("t".into(), 0, 0)).is_none());
    m.forget("t");
    assert_eq!((m.items.len(), m.bytes), (0, 0));
}

/// Design 005 E1 / acceptance „first page < 500 ms“: `cargo test --release --lib -- --ignored
/// --nocapture measure_reader` (200 pages of 1600 × 2400 px, ≈ 0,5 MB each).
/// `CC_REAL_BOOKS=<dir>` also measures the books of that folder.
#[test]
#[ignore]
fn measure_reader() {
    let d = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let page_data: Vec<(String, Vec<u8>)> = (0..200)
        .map(|i| (format!("Seite {i:03}.jpg"), build::jpeg(1600, 2400, i)))
        .collect();
    let refs: Vec<(&str, Vec<u8>)> = page_data
        .iter()
        .map(|(n, d)| (n.as_str(), d.clone()))
        .collect();
    let mut books = Vec::new();
    for (name, make) in [
        ("200.cbz", 0),
        ("200.cbt", 1),
        ("200 stored.cbr", 2),
        ("200 solid.cb7", 3),
    ] {
        let p = d.path().join(name);
        match make {
            0 => build::cbz(&p, &refs),
            1 => build::cbt(&p, &refs),
            2 => build::cbr4(&p, &refs),
            _ => build::cb7(&p, &refs, true),
        }
        books.push(p);
    }
    if let Ok(dir) = std::env::var("CC_REAL_BOOKS") {
        for e in std::fs::read_dir(dir).unwrap().flatten() {
            books.push(e.path());
        }
    }
    let service = ReaderService::new(cache.path(), page_cache::DEFAULT_LIMIT);
    for book in books {
        let size = std::fs::metadata(&book).unwrap().len() >> 20;
        let t = Instant::now();
        let events = Events::default();
        let Ok(opened) = service.open(&book, events.sink()) else {
            println!("{book:?}: cannot be opened");
            continue;
        };
        let t_open = t.elapsed();
        let first = page(&service, &opened.token, 0, 0);
        let t_first = t.elapsed();
        let n = opened.pages.len();
        let middle = page(&service, &opened.token, n / 2, 0);
        let t_middle = t.elapsed() - t_first;
        let t2 = Instant::now();
        let scaled = page(&service, &opened.token, n / 2 + 1, 1024);
        let t_scaled = t2.elapsed();
        events.wait_end();
        let t_pass = t.elapsed();
        println!(
            "{:<40} {size:>4} MiB {n:>4} pages  open {:>7.1?}  first page {:>7.1?} ({})  middle {:>7.1?} ({})  scaled 1024 {:>7.1?} ({})  pass {:>7.1?}",
            book.file_name().unwrap().to_string_lossy(),
            t_open,
            t_first,
            first.status,
            t_middle,
            middle.status,
            t_scaled,
            scaled.status,
            t_pass,
        );
        service.close(&opened.token);
    }
}

#[test]
fn a_marker_of_another_page_count_is_not_trusted() {
    // review 005 #1
    let d = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let service = ReaderService::new(cache.path(), page_cache::DEFAULT_LIMIT);
    let book = d.path().join("b.cb7");
    build::cb7(&book, &book_pages(), true);
    let meta = std::fs::metadata(&book).unwrap();
    let key = page_cache::key(&book, meta.len(), modified_ms(&meta));
    let pc = PageCache::new(cache.path(), page_cache::DEFAULT_LIMIT);
    pc.reset(&key).unwrap();
    pc.mark_complete(
        &key,
        &Complete {
            pages: vec![None; 9],
            failed: vec![],
        },
    )
    .unwrap();
    let events = Events::default();
    let opened = service.open(&book, events.sink()).unwrap();
    for (i, name) in ORDER.iter().enumerate() {
        assert_eq!(page(&service, &opened.token, i, 0).body, bytes_of(name));
    }
    assert!(events.wait_end().contains(&ReaderEvent::Done));
    assert_eq!(pc.complete(&key).unwrap().pages.len(), 4);
}

#[test]
fn two_sessions_of_one_book_share_the_unpacking() {
    // review 005 #3: the second pass must not delete the first one's pages
    let d = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let service = ReaderService::new(cache.path(), page_cache::DEFAULT_LIMIT);
    let book = d.path().join("b.cb7");
    build::cb7(&book, &book_pages(), true);
    let first = service.open(&book, Events::default().sink()).unwrap();
    let events = Events::default();
    let second = service.open(&book, events.sink()).unwrap();
    // the first reader goes away while unpacking: the second one still gets every page
    service.close(&first.token);
    for (i, name) in ORDER.iter().enumerate() {
        let r = page(&service, &second.token, i, 0);
        assert_eq!((r.status, r.body), (200, bytes_of(name)), "{name}");
    }
    events.wait_end();
    let pages_dir = cache.path().join(page_cache::DIR_NAME);
    assert_eq!(std::fs::read_dir(&pages_dir).unwrap().count(), 1);
    // done by the shared pass: complete, used by the next reader as it is
    let until = Instant::now() + Duration::from_secs(20);
    let dir = std::fs::read_dir(&pages_dir)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    while !dir.join("complete.json").exists() {
        assert!(Instant::now() < until);
        std::thread::sleep(Duration::from_millis(20));
    }
    service.close(&second.token);
    let third = service.open(&book, Events::default().sink()).unwrap();
    assert_eq!(third.pages[0].width, Some(40));
}

#[test]
fn pdf_books_are_read_like_archives() {
    // design 006 E5: scanned page as it is, vector page rendered in the asked width
    use crate::pdf::tests::make::{self, Page};
    let d = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let service = ReaderService::new(cache.path(), page_cache::DEFAULT_LIMIT);
    let scan = build::jpeg(300, 450, 9);
    let book = d.path().join("Make 01 ä.pdf");
    std::fs::write(
        &book,
        make::pdf(&[
            Page::Jpeg {
                w: 600,
                h: 900,
                data: scan.clone(),
                px: (300, 450),
                cs: "DeviceRGB",
            },
            Page::Vector { w: 400, h: 600 },
        ]),
    )
    .unwrap();
    let events = Events::default();
    let opened = service.open(&book, events.sink()).unwrap();
    assert!(!opened.extracting);
    assert_eq!(opened.pages.len(), 2);
    assert_eq!(opened.pages[1].name, "2");
    assert_eq!(
        (opened.pages[1].width, opened.pages[1].height),
        (Some(800), Some(1200))
    );
    assert!(events.wait_end().contains(&ReaderEvent::Done));
    assert_eq!(page(&service, &opened.token, 0, 1024).body, scan);
    let vector = page(&service, &opened.token, 1, 1024);
    assert_eq!((vector.status, vector.mime), (200, "image/jpeg"));
    assert_eq!(image::dimensions(&vector.body), Some((1024, 1536)));
    assert_eq!(page(&service, &opened.token, 2, 1024).status, 404);
}
