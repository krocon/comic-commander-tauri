//! Tests of `book/` and shared builders of test books (used by `cover/` too).

use super::*;
use std::io::Write;
use std::path::PathBuf;

/// Test books written in the tests themselves (RAR: stored RAR 4, the layout of
/// `testdata/archives/make_rar4.py` – there is no free RAR packer).
pub(crate) mod build {
    use image::{ImageBuffer, Rgb};
    use std::fs::File;
    use std::io::{Cursor, Write};
    use std::path::Path;

    /// A JPEG of `w`×`h` with a pattern that depends on `seed`.
    pub fn jpeg(w: u32, h: u32, seed: u32) -> Vec<u8> {
        let img = ImageBuffer::from_fn(w, h, |x, y| {
            Rgb([
                ((x * 7 + seed * 31) % 256) as u8,
                ((y * 5 + seed * 17) % 256) as u8,
                ((x + y + seed) % 256) as u8,
            ])
        });
        let mut out = Cursor::new(Vec::new());
        img.write_to(&mut out, image::ImageFormat::Jpeg).unwrap();
        out.into_inner()
    }

    pub fn png(w: u32, h: u32) -> Vec<u8> {
        let img = ImageBuffer::from_pixel(w, h, Rgb([10u8, 200, 30]));
        let mut out = Cursor::new(Vec::new());
        img.write_to(&mut out, image::ImageFormat::Png).unwrap();
        out.into_inner()
    }

    pub fn cbz(path: &Path, entries: &[(&str, Vec<u8>)]) {
        let mut w = zip::ZipWriter::new(File::create(path).unwrap());
        let o = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, data) in entries {
            if name.ends_with('/') {
                w.add_directory(*name, o).unwrap();
            } else {
                w.start_file(*name, o).unwrap();
                w.write_all(data).unwrap();
            }
        }
        w.finish().unwrap();
    }

    pub fn cbt(path: &Path, entries: &[(&str, Vec<u8>)]) {
        let mut b = tar::Builder::new(File::create(path).unwrap());
        for (name, data) in entries {
            let mut h = tar::Header::new_gnu();
            h.set_size(data.len() as u64);
            h.set_mode(0o644);
            h.set_entry_type(tar::EntryType::Regular);
            h.set_cksum();
            b.append_data(&mut h, name, &data[..]).unwrap();
        }
        b.finish().unwrap();
    }

    pub fn cb7(path: &Path, entries: &[(&str, Vec<u8>)], solid: bool) {
        let mut w = sevenz_rust2::ArchiveWriter::create(path).unwrap();
        let items: Vec<_> = entries
            .iter()
            .map(|(name, data)| {
                (
                    sevenz_rust2::ArchiveEntry::new_file(name),
                    std::io::Cursor::new(data.clone()),
                )
            })
            .collect();
        if solid {
            let (es, rs): (Vec<_>, Vec<_>) = items.into_iter().unzip();
            w.push_archive_entries(
                es,
                rs.into_iter()
                    .map(sevenz_rust2::SourceReader::new)
                    .collect::<Vec<_>>(),
            )
            .unwrap();
        } else {
            for (e, r) in items {
                w.push_archive_entry(e, Some(r)).unwrap();
            }
        }
        w.finish().unwrap();
    }

    fn rar_block(head_type: u8, flags: u16, body: &[u8]) -> Vec<u8> {
        let size = 7 + body.len() as u16;
        let mut raw = vec![head_type];
        raw.extend_from_slice(&flags.to_le_bytes());
        raw.extend_from_slice(&size.to_le_bytes());
        raw.extend_from_slice(body);
        let crc = (crc32fast::hash(&raw) & 0xFFFF) as u16;
        let mut out = crc.to_le_bytes().to_vec();
        out.extend(raw);
        out
    }

    /// A RAR 4 archive with *stored* entries (no compression).
    pub fn cbr4(path: &Path, entries: &[(&str, Vec<u8>)]) {
        let mut out = b"Rar!\x1a\x07\x00".to_vec();
        out.extend(rar_block(0x73, 0, &[0u8; 6]));
        for (name, data) in entries {
            let n = name.as_bytes();
            let mut body = Vec::new();
            body.extend_from_slice(&(data.len() as u32).to_le_bytes()); // packed
            body.extend_from_slice(&(data.len() as u32).to_le_bytes()); // unpacked
            body.push(3); // host: Unix
            body.extend_from_slice(&crc32fast::hash(data).to_le_bytes());
            body.extend_from_slice(&0x5A6B_1234u32.to_le_bytes()); // DOS time
            body.push(20); // version
            body.push(0x30); // method: store
            body.extend_from_slice(&(n.len() as u16).to_le_bytes());
            body.extend_from_slice(&0o100644u32.to_le_bytes());
            body.extend_from_slice(n);
            out.extend(rar_block(0x74, 0x8000, &body));
            out.extend_from_slice(data);
        }
        out.extend(rar_block(0x7B, 0x4000, &[]));
        std::fs::write(path, out).unwrap();
    }
}

fn testdata(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("testdata/archives")
        .join(name)
}

fn budget() -> Budget<'static> {
    Budget::new(TIME_LIMIT, None)
}

fn names(entries: &[Entry]) -> Vec<&str> {
    entries.iter().map(|e| e.name.as_str()).collect()
}

fn pages() -> Vec<(&'static str, Vec<u8>)> {
    vec![
        ("Heft ä/002.jpg", build::jpeg(40, 60, 2)),
        ("Heft ä/001.jpg", build::jpeg(40, 60, 1)),
        ("Heft ä/info.txt", b"hallo".to_vec()),
    ]
}

/// Lists the book, reads `001.jpg` and checks the bytes.
fn round_trip(path: &Path, expected: Container) {
    let (container, entries) = list(path, &budget()).unwrap();
    assert_eq!(container, expected);
    let mut n = names(&entries);
    n.sort();
    assert_eq!(n, ["Heft ä/001.jpg", "Heft ä/002.jpg", "Heft ä/info.txt"]);
    let e = entries
        .iter()
        .find(|e| e.name.ends_with("001.jpg"))
        .unwrap();
    let data = read(path, container, e, MAX_ENTRY_BYTES, &budget()).unwrap();
    assert_eq!(data, build::jpeg(40, 60, 1));
}

#[test]
fn detects_by_content_not_extension() {
    assert_eq!(detect_bytes(b"PK\x03\x04rest"), Some(Container::Zip));
    assert_eq!(detect_bytes(b"Rar!\x1a\x07\x00x"), Some(Container::Rar));
    assert_eq!(detect_bytes(b"Rar!\x1a\x07\x01\x00x"), Some(Container::Rar));
    assert_eq!(
        detect_bytes(&[b'7', b'z', 0xBC, 0xAF, 0x27, 0x1C, 0]),
        Some(Container::SevenZ)
    );
    assert_eq!(detect_bytes(b"%PDF-1.7"), Some(Container::Pdf));
    assert_eq!(detect_bytes(b"hello"), None);
    let d = tempfile::tempdir().unwrap();
    // a ".cbr" that is a ZIP (8 of them in Marc's collection)
    let p = d.path().join("Wilder Westen 03.cbr");
    build::cbz(&p, &pages());
    round_trip(&p, Container::Zip);
}

#[test]
fn all_containers() {
    let d = tempfile::tempdir().unwrap();
    let z = d.path().join("a.cbz");
    build::cbz(&z, &pages());
    round_trip(&z, Container::Zip);
    let t = d.path().join("a.cbt");
    build::cbt(&t, &pages());
    round_trip(&t, Container::Tar);
    let r = d.path().join("a.cbr");
    build::cbr4(&r, &pages());
    round_trip(&r, Container::Rar);
    for solid in [false, true] {
        let s = d.path().join(format!("a-{solid}.cb7"));
        build::cb7(&s, &pages(), solid);
        round_trip(&s, Container::SevenZ);
    }
}

#[test]
fn rar_fixtures_of_the_unrar_crate() {
    // RAR 5 + compression + Unicode, solid, encrypted (from files-and-folders testdata)
    let (c, e) = list(&testdata("rar-unicode.rar"), &budget()).unwrap();
    assert_eq!(c, Container::Rar);
    assert_eq!(e.len(), 1);
    let (c, e) = list(&testdata("rar-solid.rar"), &budget()).unwrap();
    let last = e.last().unwrap();
    let data = read(
        &testdata("rar-solid.rar"),
        c,
        last,
        MAX_ENTRY_BYTES,
        &budget(),
    )
    .unwrap();
    assert_eq!(data.len() as u64, last.size);
    let (c, e) = list(&testdata("rar-crypted.rar"), &budget()).unwrap();
    let err = read(
        &testdata("rar-crypted.rar"),
        c,
        &e[0],
        MAX_ENTRY_BYTES,
        &budget(),
    )
    .unwrap_err();
    assert_eq!(err.code, FsErrorCode::ArchiveEncrypted);
    let err = list(&testdata("rar-comment-hpw-password.rar"), &budget()).unwrap_err();
    assert_eq!(err.code, FsErrorCode::ArchiveEncrypted);
}

#[test]
fn unrar_library_is_linked() {
    // UnRAR's API version (8 or later knows RAR 5)
    assert!(rar::dll_version() >= 8, "{}", rar::dll_version());
}

#[test]
fn hostile_rar_names_and_lying_sizes() {
    // names are only strings for sorting – nothing is written; a lying size is caught
    let p = testdata("rar4-slip.rar");
    let (c, e) = list(&p, &budget()).unwrap();
    assert!(names(&e).contains(&"../evil.txt"));
    assert!(!names(&e).contains(&"link"), "links are not files");
    let liar = e.iter().find(|x| x.name == "liar.txt").unwrap();
    assert!(read(&p, c, liar, MAX_ENTRY_BYTES, &budget()).is_err());
}

#[test]
fn sevenz_fixtures() {
    let (c, e) = list(&testdata("sevenzip-solid3.7z"), &budget()).unwrap();
    assert_eq!(c, Container::SevenZ);
    let z = e.iter().find(|x| x.name == "z.txt").unwrap();
    let data = read(
        &testdata("sevenzip-solid3.7z"),
        c,
        z,
        MAX_ENTRY_BYTES,
        &budget(),
    )
    .unwrap();
    assert_eq!(data.len(), 5000);
    let (c, e) = list(&testdata("sevenzip-enc-data.7z"), &budget()).unwrap();
    let f = e.iter().find(|x| x.size > 0).unwrap();
    assert!(f.encrypted);
    assert_eq!(
        read(
            &testdata("sevenzip-enc-data.7z"),
            c,
            f,
            MAX_ENTRY_BYTES,
            &budget()
        )
        .unwrap_err()
        .code,
        FsErrorCode::ArchiveEncrypted
    );
    assert_eq!(
        list(&testdata("sevenzip-enc-names.7z"), &budget())
            .unwrap_err()
            .code,
        FsErrorCode::ArchiveEncrypted
    );
}

#[test]
fn sevenz_bombs_are_refused_before_allocating() {
    for name in [
        "bomb-header.7z",
        "bomb-files.7z",
        "bomb-zero-start.7z",
        "bomb-digests.7z",
        "bomb-bzip2-header.7z",
        "bomb-aes-header.7z",
        "bomb-folders.7z",
    ] {
        let err = list(&testdata(name), &budget()).unwrap_err();
        assert!(
            matches!(
                err.code,
                FsErrorCode::ArchiveError
                    | FsErrorCode::ArchiveTooLarge
                    | FsErrorCode::ArchiveEncrypted
            ),
            "{name}: {err:?}"
        );
    }
}

#[test]
fn entry_limits() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("big.cbz");
    build::cbz(&p, &[("big.jpg", vec![7u8; 300_000])]);
    let (c, e) = list(&p, &budget()).unwrap();
    // declared size above the limit
    assert_eq!(
        read(&p, c, &e[0], 100_000, &budget()).unwrap_err().code,
        FsErrorCode::ArchiveTooLarge
    );
    // a lying declared size: the real data is still bounded
    let mut lying = e[0].clone();
    lying.size = 10;
    assert_eq!(
        read(&p, c, &lying, 100_000, &budget()).unwrap_err().code,
        FsErrorCode::ArchiveTooLarge
    );
}

#[test]
fn budget_stops_reading() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("a.cbz");
    build::cbz(&p, &pages());
    let cancel = AtomicBool::new(true);
    let b = Budget::new(TIME_LIMIT, Some(&cancel));
    assert_eq!(list(&p, &b).unwrap_err().code, FsErrorCode::Timeout);
    let expired = Budget::new(Duration::ZERO, None);
    assert_eq!(list(&p, &expired).unwrap_err().code, FsErrorCode::Timeout);
}

#[test]
fn broken_and_unknown_books() {
    let d = tempfile::tempdir().unwrap();
    let junk = d.path().join("junk.cbz");
    std::fs::write(&junk, b"not a book at all").unwrap();
    assert_eq!(
        list(&junk, &budget()).unwrap_err().code,
        FsErrorCode::UnsupportedFormat
    );
    let cut = d.path().join("cut.cbz");
    build::cbz(&cut, &pages());
    let data = std::fs::read(&cut).unwrap();
    std::fs::write(&cut, &data[..data.len() / 2]).unwrap();
    assert_eq!(
        list(&cut, &budget()).unwrap_err().code,
        FsErrorCode::ArchiveError
    );
    let pdf = d.path().join("Make 01.pdf");
    let mut f = std::fs::File::create(&pdf).unwrap();
    f.write_all(b"%PDF-1.4\n%...").unwrap();
    assert_eq!(
        list(&pdf, &budget()).unwrap_err().code,
        FsErrorCode::UnsupportedFormat
    );
    assert_eq!(
        list(&d.path().join("missing.cbz"), &budget())
            .unwrap_err()
            .code,
        FsErrorCode::NotFound
    );
}
