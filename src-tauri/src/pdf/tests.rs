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
        /// Objects as given: the content stream object and an image object (`/Im0`).
        Raw {
            w: u32,
            h: u32,
            content: Vec<u8>,
            image: Option<Vec<u8>>,
        },
    }

    /// A stream object: `dict` entries (without `/Length`) and data.
    pub fn stream(dict: &str, data: &[u8]) -> Vec<u8> {
        let mut o = format!("<< {dict} /Length {} >>\nstream\n", data.len()).into_bytes();
        o.extend_from_slice(data);
        o.extend_from_slice(b"\nendstream");
        o
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
            if let Page::Raw {
                w,
                h,
                content,
                image,
            } = p
            {
                let xobj = if image.is_some() {
                    format!("/XObject << /Im0 {image_id} 0 R >> ")
                } else {
                    String::new()
                };
                page_objs.push((page_id, format!(
                    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w} {h}] /Resources << {xobj}>> /Contents {content_id} 0 R >>"
                ).into_bytes()));
                page_objs.push((content_id, content.clone()));
                page_objs.push((image_id, image.clone().unwrap_or_else(|| b"null".to_vec())));
                continue;
            }
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
                Page::Raw { .. } => unreachable!(),
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
    let s = PdfBook::scale(100.0, 100_000.0, 4096, None).unwrap();
    assert!(s * 100_000.0 <= MAX_SIDE as f32 + 1.0);
    let s = PdfBook::scale(10_000.0, 10_000.0, 16_000, None).unwrap();
    assert!((10_000.0 * s).powi(2) <= MAX_PIXELS as f32 * 1.01);
    // review 006 #2: no floor – a page that would be less than a pixel is refused
    // a huge page is drawn small, a hair-thin one would be under a pixel
    assert_eq!(
        PdfBook::scale(1e8, 1e8, 2048, None).map(|s| (1e8 * s).round()),
        Some(2048.0)
    );
    assert_eq!(PdfBook::scale(1e8, 1.0, 2048, None), None);
    assert_eq!(PdfBook::scale(f32::INFINITY, 100.0, 2048, None), None);
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

fn deflate(data: &[u8]) -> Vec<u8> {
    use std::io::Write;
    let mut e = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::best());
    e.write_all(data).unwrap();
    e.finish().unwrap()
}

fn jpeg_object(data: &[u8], (w, h): (u32, u32), cs: &str) -> Vec<u8> {
    make::stream(
        &format!(
            "/Type /XObject /Subtype /Image /Width {w} /Height {h} /ColorSpace /{cs} /BitsPerComponent 8 /Filter /DCTDecode"
        ),
        data,
    )
}

#[test]
fn decompression_bombs_are_refused_before_hayro_sees_them() {
    // review 006 #1: twice deflated zeros – a few hundred bytes, 300 MiB unpacked
    let d = tempfile::tempdir().unwrap();
    let bomb = deflate(&deflate(&vec![0u8; guard::MAX_STREAM + 1024]));
    assert!(bomb.len() < 4096);
    let p = write(
        d.path(),
        "bombe.pdf",
        &[Page::Raw {
            w: 400,
            h: 600,
            content: make::stream("/Filter [/FlateDecode /FlateDecode]", &bomb),
            image: None,
        }],
    );
    assert_eq!(
        PdfBook::open(&p).err().map(|e| e.code),
        Some(FsErrorCode::ArchiveTooLarge)
    );
    assert_eq!(
        thumbnail(&p, 200, 300).unwrap_err().code,
        FsErrorCode::ArchiveTooLarge
    );
    // an image declaring 100 000 × 100 000 pixels
    let huge = make::stream(
        "/Type /XObject /Subtype /Image /Width 100000 /Height 100000 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode",
        &deflate(b"x"),
    );
    let p = write(
        d.path(),
        "riesig.pdf",
        &[Page::Raw {
            w: 400,
            h: 600,
            content: make::stream("", b"q 400 0 0 600 0 0 cm /Im0 Do Q"),
            image: Some(huge),
        }],
    );
    assert_eq!(
        PdfBook::open(&p).err().map(|e| e.code),
        Some(FsErrorCode::ArchiveTooLarge)
    );
    // a normal compressed content stream passes
    let p = write(
        d.path(),
        "normal.pdf",
        &[Page::Raw {
            w: 400,
            h: 600,
            content: make::stream("/Filter /FlateDecode", &deflate(b"0 0 1 rg 0 0 50 50 re f")),
            image: None,
        }],
    );
    assert!(PdfBook::open(&p).is_ok());
}

#[test]
fn fast_way_needs_the_image_on_the_page_and_usable() {
    // review 006 #5, #6
    let d = tempfile::tempdir().unwrap();
    let j = build::jpeg(300, 450, 3);
    let page = |content: &str, image: Vec<u8>| Page::Raw {
        w: 600,
        h: 900,
        content: make::stream("", content.as_bytes()),
        image: Some(image),
    };
    let cmyk = {
        let mut out = Vec::new();
        let img = image::ImageBuffer::from_pixel(30, 30, image::Rgb([1u8, 2, 3]));
        image::codecs::jpeg::JpegEncoder::new(&mut out)
            .encode_image(&image::DynamicImage::ImageRgb8(img).to_luma8())
            .unwrap();
        out
    };
    let p = write(
        d.path(),
        "schnellweg.pdf",
        &[
            // nested q/cm: still the whole page
            page(
                "q 2 0 0 3 0 0 cm q 300 0 0 300 0 0 cm /Im0 Do Q Q",
                jpeg_object(&j, (300, 450), "DeviceRGB"),
            ),
            // moved mostly off the page
            page(
                "q 600 0 0 900 500 0 cm /Im0 Do Q",
                jpeg_object(&j, (300, 450), "DeviceRGB"),
            ),
            // grey JPEG: usable
            page(
                "q 600 0 0 900 0 0 cm /Im0 Do Q",
                jpeg_object(&cmyk, (30, 30), "DeviceGray"),
            ),
            // not a JPEG behind DCTDecode
            page(
                "q 600 0 0 900 0 0 cm /Im0 Do Q",
                jpeg_object(b"\xff\xd8\xff junk", (30, 30), "DeviceRGB"),
            ),
        ],
    );
    let book = PdfBook::open(&p).unwrap();
    assert_eq!(book.page_jpeg(0).unwrap(), j);
    assert!(book.page_jpeg(1).is_none());
    assert!(book.page_jpeg(2).is_some());
    assert!(book.page_jpeg(3).is_none());
    assert!(!fast::usable(b"\xff\xd8\xff"));
}
