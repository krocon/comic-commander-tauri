use super::*;
use crate::book::tests::build;
use std::sync::mpsc;
use std::time::Duration;

#[test]
fn parses_only_well_formed_paths() {
    let ok = parse_path("/c0123456789ab.0123456789abcdef.1").unwrap();
    assert_eq!(ok.category_id, "c0123456789ab");
    assert_eq!(ok.book_id, "0123456789abcdef");
    assert_eq!(ok.dim_index, 1);
    for bad in [
        "",
        "/",
        "/c0123456789ab.0123456789abcdef",
        "/c0123456789ab.0123456789abcdef.1.2",
        "/x0123456789ab.0123456789abcdef.1",
        "/c0123456789ab.0123456789ABCDEF.1",
        "/c0123456789ab.0123456789abcdef.-1",
        "/c0123456789ab.0123456789abcdef.99",
        "/c0123456789ab.../etc/passwd.1",
        "/c0123456789ab%2F0123456789abcdef.1",
    ] {
        assert_eq!(parse_path(bad), None, "{bad}");
    }
}

#[test]
fn http_status_of_failures() {
    let s = |c| Reply::error(&FsError::new(c, "x", None)).status;
    assert_eq!(s(FsErrorCode::NoImage), 404);
    assert_eq!(s(FsErrorCode::UnsupportedFormat), 415);
    assert_eq!(s(FsErrorCode::ArchiveEncrypted), 422);
    assert_eq!(s(FsErrorCode::Timeout), 422);
    assert_eq!(s(FsErrorCode::Busy), 503);
    assert_eq!(s(FsErrorCode::Io), 500);
}

fn dim(w: u32, h: u32, suffix: &str) -> ThumbsDim {
    ThumbsDim {
        width: w,
        height: h,
        name_extension: suffix.into(),
    }
}

fn ask(service: &Arc<CoverService>, book: &Path, d: &ThumbsDim) -> Reply {
    let (tx, rx) = mpsc::channel();
    service.serve(
        book.to_path_buf(),
        d,
        Box::new(move |r| {
            let _ = tx.send(r);
        }),
    );
    rx.recv_timeout(Duration::from_secs(20)).unwrap()
}

#[test]
fn makes_caches_and_serves_thumbnails() {
    let lib = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let service = CoverService::new(cache.path(), 2);
    let book = lib.path().join("Hägar 01 🦸.cbr");
    build::cbr4(
        &book,
        &[
            ("002.jpg", build::jpeg(400, 600, 2)),
            ("001.jpg", build::jpeg(400, 600, 1)),
        ],
    );
    let r = ask(&service, &book, &dim(200, 300, ""));
    assert_eq!((r.status, r.mime), (200, "image/jpeg"));
    let img = ::image::load_from_memory(&r.body).unwrap();
    assert_eq!((img.width(), img.height()), (200, 300));
    // the second answer comes from the disk cache – same bytes, nothing in the comic folder
    assert_eq!(ask(&service, &book, &dim(200, 300, "")), r);
    assert_eq!(std::fs::read_dir(lib.path()).unwrap().count(), 1);
    // another size is another thumbnail
    let big = ask(&service, &book, &dim(800, 1200, "_xl"));
    assert_eq!(::image::load_from_memory(&big.body).unwrap().height(), 600);
}

#[test]
fn sidecars_of_the_old_app_win() {
    let lib = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let service = CoverService::new(cache.path(), 1);
    let book = lib.path().join("Der Henker 01.cbz");
    build::cbz(&book, &[("001.jpg", build::jpeg(400, 600, 1))]);
    let sidecar = build::jpeg(200, 280, 9);
    std::fs::write(lib.path().join("Der Henker 01_xl.jpg"), &sidecar).unwrap();
    assert_eq!(ask(&service, &book, &dim(800, 1200, "_xl")).body, sidecar);
    assert_ne!(ask(&service, &book, &dim(200, 300, "")).body, sidecar);
}

#[test]
fn failures_get_a_status_and_are_remembered() {
    let lib = tempfile::tempdir().unwrap();
    let cache = tempfile::tempdir().unwrap();
    let service = CoverService::new(cache.path(), 1);
    let text = lib.path().join("Nur Text.cbz");
    build::cbz(&text, &[("info.txt", b"hallo".to_vec())]);
    assert_eq!(ask(&service, &text, &dim(200, 300, "")).status, 404);
    let junk = lib.path().join("kaputt.cbr");
    std::fs::write(&junk, b"Rar!\x1a\x07\x00 nothing behind").unwrap();
    assert_eq!(ask(&service, &junk, &dim(200, 300, "")).status, 422);
    let broken_page = lib.path().join("Seite kaputt.cbz");
    build::cbz(
        &broken_page,
        &[("001.jpg", b"\xff\xd8\xff not really".to_vec())],
    );
    assert_eq!(ask(&service, &broken_page, &dim(200, 300, "")).status, 422);
    let pdf = lib.path().join("Make 01.pdf");
    // a broken PDF (design 006: PDFs have covers now)
    std::fs::write(&pdf, b"%PDF-1.4\n").unwrap();
    assert_eq!(ask(&service, &pdf, &dim(200, 300, "")).status, 422);
    assert_eq!(
        ask(&service, &lib.path().join("weg.cbz"), &dim(200, 300, "")).status,
        404
    );
    let failures = service.failures();
    assert_eq!(failures.len(), 4);
    assert!(failures.values().any(|c| *c == FsErrorCode::NoImage));
    // remembered: the second answer does not open the book again
    std::fs::remove_file(&junk).unwrap();
    std::fs::write(&junk, b"Rar!\x1a\x07\x00 nothing behind").unwrap();
    assert_eq!(ask(&service, &junk, &dim(200, 300, "")).status, 422);
}

/// Real books from Marc's collection (not in the repo): `CC_REAL_BOOKS=<dir> cargo test --release
/// -- --ignored --nocapture real_books`.
#[test]
#[ignore]
fn real_books() {
    let Ok(dir) = std::env::var("CC_REAL_BOOKS") else {
        return;
    };
    let cache = tempfile::tempdir().unwrap();
    let service = CoverService::new(cache.path(), 2);
    for entry in walk(Path::new(&dir)) {
        let t = std::time::Instant::now();
        let r = ask(&service, &entry, &dim(200, 300, ""));
        let first = t.elapsed();
        let t = std::time::Instant::now();
        let again = ask(&service, &entry, &dim(200, 300, ""));
        let cached = t.elapsed();
        let t = std::time::Instant::now();
        let xl = ask(&service, &entry, &dim(800, 1200, "_xl"));
        let xl_time = t.elapsed();
        assert_eq!(r, again);
        let Ok(img) = ::image::load_from_memory(&r.body) else {
            println!(
                "MEASURE {} status={} {}",
                entry.display(),
                r.status,
                String::from_utf8_lossy(&r.body)
            );
            continue;
        };
        println!(
            "MEASURE {} status={} {}x{} first={first:?} cached={cached:?} xl={xl_time:?} ({} bytes)",
            entry.file_name().unwrap().to_string_lossy(),
            r.status,
            img.width(),
            img.height(),
            xl.body.len()
        );
        assert!(cached < Duration::from_millis(5), "{cached:?}");
    }
}

fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for e in std::fs::read_dir(dir).unwrap().flatten() {
        let p = e.path();
        if p.is_dir() {
            out.extend(walk(&p));
        } else if crate::book::detect(&p).is_ok() {
            out.push(p);
        }
    }
    out
}

/// Only failures that a retry cannot change are remembered (review 003 #5).
#[test]
fn only_lasting_failures_are_remembered() {
    use FsErrorCode as C;
    for c in [
        C::NoImage,
        C::UnsupportedFormat,
        C::UnsupportedImage,
        C::ArchiveError,
        C::ArchiveEncrypted,
        C::ArchiveTooLarge,
    ] {
        assert!(remembered(c), "{c:?}");
    }
    for c in [C::Timeout, C::Busy, C::Io, C::NotFound, C::PermissionDenied] {
        assert!(!remembered(c), "{c:?}");
    }
}
