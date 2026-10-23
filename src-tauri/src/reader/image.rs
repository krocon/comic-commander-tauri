//! Page images for the WebView (design 005 E2/E7): only real images (magic bytes) are served,
//! with their sizes checked against the limits of 003; the original bytes unless the image is
//! much wider than the window needs – then a scaled JPEG.

use crate::cover::image::{MAX_PIXELS, MAX_SIDE, scale_jpeg};
use crate::error::{FsError, FsErrorCode};
use image::ImageReader;
use std::io::Cursor;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::Path;

/// Scale only above this factor of the target width (E2).
pub const SCALE_ABOVE: f64 = 1.25;
/// JPEG quality of scaled pages.
pub const QUALITY: u8 = 90;

/// The MIME type of an image the WebView may get, from its first bytes – `None` for anything
/// else (HTML, SVG, scripts in a hostile book are never served).
pub fn sniff(data: &[u8]) -> Option<&'static str> {
    if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if data.len() >= 12 && &data[..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        Some("image/webp")
    } else if data.starts_with(b"BM") && data.len() >= 26 {
        Some("image/bmp")
    } else {
        None
    }
}

/// Width and height from the header (also from the first bytes of an image only).
pub fn dimensions(data: &[u8]) -> Option<(u32, u32)> {
    // PNG and GIF: fixed header fields (the decoders want more than the header)
    if data.starts_with(b"\x89PNG\r\n\x1a\n") && data.len() >= 24 && &data[12..16] == b"IHDR" {
        let be = |i: usize| u32::from_be_bytes([data[i], data[i + 1], data[i + 2], data[i + 3]]);
        return Some((be(16), be(20))).filter(|(w, h)| *w > 0 && *h > 0);
    }
    if (data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a")) && data.len() >= 10 {
        let le = |i: usize| u32::from(u16::from_le_bytes([data[i], data[i + 1]]));
        return Some((le(6), le(8))).filter(|(w, h)| *w > 0 && *h > 0);
    }
    catch_unwind(AssertUnwindSafe(|| {
        ImageReader::new(Cursor::new(data))
            .with_guessed_format()
            .ok()?
            .into_dimensions()
            .ok()
    }))
    .ok()
    .flatten()
    .filter(|(w, h)| *w > 0 && *h > 0)
}

/// What the WebView gets for `data`: (bytes, MIME). `width` = target width in device pixels,
/// 0 = always the original.
pub fn prepare(data: Vec<u8>, width: u32, path: &Path) -> Result<(Vec<u8>, &'static str), FsError> {
    let mime = sniff(&data).ok_or_else(|| {
        FsError::new(
            FsErrorCode::UnsupportedFormat,
            "the page is not an image",
            Some(path),
        )
    })?;
    let (w, h) = dimensions(&data).ok_or_else(|| {
        FsError::new(
            FsErrorCode::UnsupportedImage,
            "the image cannot be read",
            Some(path),
        )
    })?;
    if w > MAX_SIDE || h > MAX_SIDE || u64::from(w) * u64::from(h) > MAX_PIXELS {
        return Err(FsError::new(
            FsErrorCode::ArchiveTooLarge,
            format!("the image is too large ({w} × {h})"),
            Some(path),
        ));
    }
    if width == 0 || mime == "image/gif" || f64::from(w) <= f64::from(width) * SCALE_ABOVE {
        return Ok((data, mime));
    }
    Ok((scale_jpeg(&data, width, QUALITY, path)?, "image/jpeg"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::book::tests::build;

    #[test]
    fn sniffs_images_only() {
        assert_eq!(sniff(&build::jpeg(4, 4, 1)), Some("image/jpeg"));
        assert_eq!(sniff(&build::png(4, 4)), Some("image/png"));
        assert_eq!(sniff(b"GIF89a....."), Some("image/gif"));
        assert_eq!(sniff(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(sniff(b"<html><script>alert(1)</script>"), None);
        assert_eq!(sniff(b"<svg xmlns='http://www.w3.org/2000/svg'/>"), None);
        assert_eq!(sniff(b""), None);
    }

    #[test]
    fn dimensions_from_a_prefix() {
        let j = build::jpeg(300, 450, 2);
        assert_eq!(dimensions(&j), Some((300, 450)));
        assert_eq!(dimensions(&j[..j.len().min(2048)]), Some((300, 450)));
        assert_eq!(dimensions(&build::png(30, 20)[..40]), Some((30, 20)));
        assert_eq!(dimensions(b"nope"), None);
    }

    #[test]
    fn original_unless_much_wider() {
        let p = Path::new("x");
        let j = build::jpeg(1200, 1800, 1);
        // fits (≤ 1.25 × 1024) or original asked: the same bytes
        assert_eq!(prepare(j.clone(), 1024, p).unwrap().0, j);
        assert_eq!(prepare(j.clone(), 0, p).unwrap().0, j);
        let png = build::png(3000, 200);
        let (scaled, mime) = prepare(png, 1024, p).unwrap();
        assert_eq!(mime, "image/jpeg");
        assert_eq!(dimensions(&scaled), Some((1024, 68)));
    }

    #[test]
    fn refuses_non_images_and_huge_ones() {
        let p = Path::new("x");
        assert_eq!(
            prepare(b"<html>".to_vec(), 0, p).unwrap_err().code,
            FsErrorCode::UnsupportedFormat
        );
        assert_eq!(
            prepare(b"\xff\xd8\xff broken".to_vec(), 0, p)
                .unwrap_err()
                .code,
            FsErrorCode::UnsupportedImage
        );
        // a PNG header declaring 20 000 × 20 000 pixels
        let mut ihdr = b"IHDR".to_vec();
        ihdr.extend_from_slice(&20_000u32.to_be_bytes());
        ihdr.extend_from_slice(&20_000u32.to_be_bytes());
        ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\r".to_vec();
        png.extend_from_slice(&ihdr);
        png.extend_from_slice(&crc32fast::hash(&ihdr).to_be_bytes());
        assert_eq!(
            prepare(png, 0, p).unwrap_err().code,
            FsErrorCode::ArchiveTooLarge
        );
    }
}
