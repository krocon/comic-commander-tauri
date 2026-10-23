use super::*;
use crate::book::tests::build;

/// Small PDFs written by hand (objects + xref) – no PDF library needed.
pub(crate) mod make {
    pub enum Page {
        /// One JPEG over the whole page (`w` × `h` points), colour space as given.
        Jpeg {
            w: u32,
            h: u32,
            data: Vec<u8>,
            px: (u32, u32),
            cs: &'static str,
        },
        /// The JPEG drawn small (not a scan page).
        SmallJpeg {
            w: u32,
            h: u32,
            data: Vec<u8>,
            px: (u32, u32),
        },
        /// Shapes and text.
        Vector { w: u32, h: u32 },
        /// A page with `/Rotate 90`.
        Rotated { w: u32, h: u32 },
    }

    /// Width, height, content stream, image (bytes, pixels, colour space), extra page keys.
    type PageParts<'a> = (
        u32,
        u32,
        String,
        Option<(Vec<u8>, (u32, u32), &'a str)>,
        &'a str,
    );

    pub fn pdf(pages: &[Page]) -> Vec<u8> {
        let mut objs: Vec<Vec<u8>> = Vec::new();
        let n = pages.len();
        // 1 catalog, 2 pages, 3 font, then per page: page, content, (image)
        let mut kids = Vec::new();
        let mut next = 4;
        let mut page_objs: Vec<(usize, Vec<u8>)> = Vec::new();
        for p in pages {
            let page_id = next;
            let content_id = next + 1;
            let image_id = next + 2;
            next += 3;
            kids.push(format!("{page_id} 0 R"));
            let (w, h, content, image, rotate): PageParts<'_> = match p {
                Page::Jpeg { w, h, data, px, cs } => (
                    *w,
                    *h,
                    format!("q {w} 0 0 {h} 0 0 cm /Im0 Do Q"),
                    Some((data.clone(), *px, *cs)),
                    "",
                ),
                Page::SmallJpeg { w, h, data, px } => (
                    *w,
                    *h,
                    "q 50 0 0 50 10 10 cm /Im0 Do Q".into(),
                    Some((data.clone(), *px, "DeviceRGB")),
                    "",
                ),
                Page::Vector { w, h } => (
                    *w,
                    *h,
                    "1 0 0 rg 10 10 100 100 re f BT /F1 24 Tf 20 200 Td (Hallo Welt) Tj ET".into(),
                    None,
                    "",
                ),
                Page::Rotated { w, h } => (
                    *w,
                    *h,
                    "0 0 1 rg 0 0 50 50 re f".into(),
                    None,
                    "/Rotate 90 ",
                ),
            };
            let xobj = if image.is_some() {
                format!("/XObject << /Im0 {image_id} 0 R >> ")
            } else {
                String::new()
            };
            page_objs.push((page_id, format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w} {h}] {rotate}/Resources << {xobj}/Font << /F1 3 0 R >> >> /Contents {content_id} 0 R >>"
            ).into_bytes()));
            let mut c = format!("<< /Length {} >>\nstream\n", content.len()).into_bytes();
            c.extend_from_slice(content.as_bytes());
            c.extend_from_slice(b"\nendstream");
            page_objs.push((content_id, c));
            let mut img = match image {
                Some((data, (pw, ph), cs)) => {
                    let mut o = format!(
                        "<< /Type /XObject /Subtype /Image /Width {pw} /Height {ph} /ColorSpace /{cs} /BitsPerComponent 8 /Filter /DCTDecode /Length {} >>\nstream\n",
                        data.len()
                    ).into_bytes();
                    o.extend_from_slice(&data);
                    o.extend_from_slice(b"\nendstream");
                    o
                }
                None => b"null".to_vec(),
            };
            page_objs.push((image_id, std::mem::take(&mut img)));
        }
        objs.push(b"<< /Type /Catalog /Pages 2 0 R >>".to_vec());
        objs.push(format!("<< /Type /Pages /Kids [{}] /Count {n} >>", kids.join(" ")).into_bytes());
        objs.push(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_vec());
        page_objs.sort_by_key(|o| o.0);
        objs.extend(page_objs.into_iter().map(|o| o.1));
        let mut out = b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n".to_vec();
        let mut offsets = Vec::new();
        for (i, o) in objs.iter().enumerate() {
            offsets.push(out.len());
            out.extend_from_slice(format!("{} 0 obj\n", i + 1).as_bytes());
            out.extend_from_slice(o);
            out.extend_from_slice(b"\nendobj\n");
        }
        let xref = out.len();
        out.extend_from_slice(
            format!("xref\n0 {}\n0000000000 65535 f \n", objs.len() + 1).as_bytes(),
        );
        for off in offsets {
            out.extend_from_slice(format!("{off:010} 00000 n \n").as_bytes());
        }
        out.extend_from_slice(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
                objs.len() + 1
            )
            .as_bytes(),
        );
        out
    }
}

use make::Page;

fn scan_page(seed: u32) -> (Page, Vec<u8>) {
    let data = build::jpeg(300, 450, seed);
    (
        Page::Jpeg {
            w: 600,
            h: 900,
            data: data.clone(),
            px: (300, 450),
            cs: "DeviceRGB",
        },
        data,
    )
}

fn write(dir: &Path, name: &str, pages: &[Page]) -> PathBuf {
    let p = dir.join(name);
    std::fs::write(&p, make::pdf(pages)).unwrap();
    p
}

fn size_of(jpeg: &[u8]) -> (u32, u32) {
    let img = image::load_from_memory(jpeg).unwrap();
    (img.width(), img.height())
}

#[test]
fn pages_and_sizes() {
    let d = tempfile::tempdir().unwrap();
    let p = write(
        d.path(),
        "Gemischt ä 🦸.pdf",
        &[
            Page::Vector { w: 595, h: 842 },
            Page::Vector { w: 842, h: 595 },
            Page::Rotated { w: 200, h: 300 },
        ],
    );
    let book = PdfBook::open(&p).unwrap();
    assert_eq!(book.page_count(), 3);
    assert_eq!(book.sizes, [(595.0, 842.0), (842.0, 595.0), (300.0, 200.0)]);
}

#[test]
fn scanned_pages_go_the_fast_way() {
    let d = tempfile::tempdir().unwrap();
    let (page, jpeg) = scan_page(1);
    let p = write(d.path(), "scan.pdf", &[page]);
    let book = PdfBook::open(&p).unwrap();
    assert_eq!(book.page_jpeg(0).unwrap(), jpeg);
    assert_eq!(page_image(&book, 0, 2048).unwrap(), jpeg);
    // the cover is the thumbnail of that JPEG
    assert_eq!(size_of(&thumbnail(&p, 200, 300).unwrap()), (200, 300));
}

#[test]
fn no_fast_way_for_anything_else() {
    let d = tempfile::tempdir().unwrap();
    let j = build::jpeg(100, 100, 2);
    let p = write(
        d.path(),
        "andere.pdf",
        &[
            Page::Vector { w: 400, h: 600 },
            Page::SmallJpeg {
                w: 400,
                h: 600,
                data: j.clone(),
                px: (100, 100),
            },
            Page::Jpeg {
                w: 400,
                h: 600,
                data: j.clone(),
                px: (100, 100),
                cs: "DeviceCMYK",
            },
            Page::Rotated { w: 400, h: 600 },
        ],
    );
    let book = PdfBook::open(&p).unwrap();
    for i in 0..4 {
        assert!(book.page_jpeg(i).is_none(), "page {i}");
    }
}

#[test]
fn rendered_pages_have_the_asked_width() {
    let d = tempfile::tempdir().unwrap();
    let p = write(
        d.path(),
        "vektor.pdf",
        &[
            Page::Vector { w: 400, h: 600 },
            Page::Rotated { w: 200, h: 300 },
        ],
    );
    let book = PdfBook::open(&p).unwrap();
    assert_eq!(size_of(&page_image(&book, 0, 1024).unwrap()), (1024, 1536));
    assert_eq!(
        size_of(&page_image(&book, 0, 0).unwrap()),
        (DEFAULT_WIDTH, 3072)
    );
    // rotated: landscape
    assert_eq!(size_of(&page_image(&book, 1, 600).unwrap()), (600, 400));
    // red square of the vector page is drawn (bottom left)
    let img = image::load_from_memory(&page_image(&book, 0, 400).unwrap())
        .unwrap()
        .to_rgb8();
    let px = img.get_pixel(50, 600 - 50);
    assert!(px[0] > 200 && px[1] < 60 && px[2] < 60, "{px:?}");
    // the cover fits inside the thumbnail size
    let (w, h) = size_of(&thumbnail(&p, 200, 300).unwrap());
    assert!(w <= 200 && h <= 300 && (w == 200 || h == 300), "{w}×{h}");
    assert_eq!(
        page_image(&book, 2, 100).unwrap_err().code,
        FsErrorCode::NotFound
    );
}

#[test]
fn output_stays_within_the_pixel_limits() {
    assert!(PdfBook::scale(100.0, 100_000.0, 4096, None) * 100_000.0 <= MAX_SIDE as f32 + 1.0);
    let s = PdfBook::scale(10_000.0, 10_000.0, 16_000, None);
    assert!((10_000.0 * s).powi(2) <= MAX_PIXELS as f32 * 1.01);
}

#[test]
fn broken_empty_and_encrypted_pdfs_are_codes() {
    let d = tempfile::tempdir().unwrap();
    let code = |bytes: &[u8]| {
        let p = d.path().join("x.pdf");
        std::fs::write(&p, bytes).unwrap();
        PdfBook::open(&p).err().map(|e| e.code)
    };
    let mut garbage = b"%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n".to_vec();
    garbage.extend((0..3000u32).map(|i| (i * 7 % 251) as u8));
    assert_eq!(code(&garbage), Some(FsErrorCode::ArchiveError));
    assert_eq!(code(&make::pdf(&[])), Some(FsErrorCode::NoImage));
    assert_eq!(code(b""), Some(FsErrorCode::ArchiveError));
    let enc = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("testdata/pdf/encrypted.pdf");
    assert_eq!(
        PdfBook::open(&enc).err().map(|e| e.code),
        Some(FsErrorCode::ArchiveEncrypted)
    );
    assert_eq!(
        PdfBook::open(&d.path().join("missing.pdf"))
            .err()
            .map(|e| e.code),
        Some(FsErrorCode::NotFound)
    );
}
