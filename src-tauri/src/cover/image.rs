//! Decoding a page and making the thumbnail (design 003). Decoder with limits taken over from
//! files-and-folders `duplicates/images.rs` (design 042 E6): the header is read first and too
//! large images are refused **before** any pixel is decoded; the decoder runs with
//! `image::Limits` and inside `catch_unwind`; at most [`MAX_DECODES`] decodes at once.

use crate::error::{FsError, FsErrorCode};
use image::{DynamicImage, ImageReader, Limits};
use std::io::Cursor;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::Path;
use std::sync::{Condvar, Mutex, OnceLock};

/// Longest side accepted.
pub const MAX_SIDE: u32 = 16_384;
/// Most pixels accepted (≈ 64 MP – a 2560 × 3600 scan has 9 MP).
pub const MAX_PIXELS: u64 = 64_000_000;
/// What a decoder may allocate.
pub const MAX_ALLOC: u64 = 320 << 20;
/// Decodes at once in the whole app.
pub const MAX_DECODES: usize = 4;
/// JPEG quality of the thumbnails (design 003 E2, as the old app).
pub const QUALITY: u8 = 80;

fn bad(message: impl Into<String>, path: &Path) -> FsError {
    FsError::new(FsErrorCode::UnsupportedImage, message, Some(path))
}

fn limits() -> Limits {
    let mut l = Limits::default();
    l.max_image_width = Some(MAX_SIDE);
    l.max_image_height = Some(MAX_SIDE);
    l.max_alloc = Some(MAX_ALLOC);
    l
}

/// Decodes image bytes with all limits (`path` only for the messages).
pub fn decode(data: &[u8], path: &Path) -> Result<DynamicImage, FsError> {
    let reader = || -> Result<ImageReader<Cursor<&[u8]>>, FsError> {
        let mut r = ImageReader::new(Cursor::new(data))
            .with_guessed_format()
            .map_err(|e| FsError::from_io(&e, path))?;
        if r.format().is_none() {
            return Err(bad("not an image format that can be read", path));
        }
        r.limits(limits());
        Ok(r)
    };
    let outcome = catch_unwind(AssertUnwindSafe(|| -> Result<DynamicImage, FsError> {
        let (w, h) = reader()?
            .into_dimensions()
            .map_err(|e| bad(format!("the image cannot be read ({e})"), path))?;
        if w == 0 || h == 0 {
            return Err(bad("the image is empty", path));
        }
        if w > MAX_SIDE || h > MAX_SIDE || u64::from(w) * u64::from(h) > MAX_PIXELS {
            return Err(FsError::new(
                FsErrorCode::ArchiveTooLarge,
                format!("the image is too large ({w} × {h})"),
                Some(path),
            ));
        }
        reader()?
            .decode()
            .map_err(|e| bad(format!("the image cannot be read ({e})"), path))
    }));
    outcome.unwrap_or_else(|_| Err(bad("the image cannot be read (decoder failure)", path)))
}

struct Permits {
    used: Mutex<usize>,
    freed: Condvar,
}

fn permits() -> &'static Permits {
    static P: OnceLock<Permits> = OnceLock::new();
    P.get_or_init(|| Permits {
        used: Mutex::new(0),
        freed: Condvar::new(),
    })
}

struct Permit;

impl Permit {
    fn take() -> Permit {
        let p = permits();
        let mut used = p.used.lock().unwrap_or_else(|e| e.into_inner());
        while *used >= MAX_DECODES {
            used = p.freed.wait(used).unwrap_or_else(|e| e.into_inner());
        }
        *used += 1;
        Permit
    }
}

impl Drop for Permit {
    fn drop(&mut self) {
        let p = permits();
        let mut used = p.used.lock().unwrap_or_else(|e| e.into_inner());
        *used -= 1;
        p.freed.notify_one();
    }
}

/// The thumbnail of an image: fit inside `width` × `height` without enlarging (like `sharp`
/// with `fit: inside, withoutEnlargement` in the old app), as JPEG.
pub fn thumbnail_jpeg(
    data: &[u8],
    width: u32,
    height: u32,
    path: &Path,
) -> Result<Vec<u8>, FsError> {
    let _permit = Permit::take();
    let img = decode(data, path)?;
    let img = if img.width() > width || img.height() > height {
        img.thumbnail(width, height)
    } else {
        img
    };
    let rgb = img.to_rgb8();
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, QUALITY)
        .encode_image(&rgb)
        .map_err(|e| bad(format!("no thumbnail ({e})"), path))?;
    Ok(out)
}

/// A page scaled to `width` (aspect kept, never enlarged) as JPEG – for the reader (design 005
/// E2). Shares the decode permits with the covers.
pub fn scale_jpeg(data: &[u8], width: u32, quality: u8, path: &Path) -> Result<Vec<u8>, FsError> {
    let _permit = Permit::take();
    let img = decode(data, path)?;
    let img = if img.width() > width {
        img.thumbnail(width, u32::MAX)
    } else {
        img
    };
    let rgb = img.to_rgb8();
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality)
        .encode_image(&rgb)
        .map_err(|e| bad(format!("the page cannot be scaled ({e})"), path))?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::book::tests::build;

    fn size_of(jpeg: &[u8]) -> (u32, u32) {
        let img = image::load_from_memory(jpeg).unwrap();
        (img.width(), img.height())
    }

    #[test]
    fn fits_inside_without_enlarging() {
        let p = Path::new("x");
        let page = build::jpeg(640, 900, 1);
        assert_eq!(
            size_of(&thumbnail_jpeg(&page, 200, 300, p).unwrap()),
            (200, 281)
        );
        let small = build::jpeg(100, 150, 2);
        assert_eq!(
            size_of(&thumbnail_jpeg(&small, 200, 300, p).unwrap()),
            (100, 150)
        );
        let wide = build::png(900, 300);
        assert_eq!(
            size_of(&thumbnail_jpeg(&wide, 200, 300, p).unwrap()),
            (200, 67)
        );
    }

    #[test]
    fn broken_images_are_errors_not_panics() {
        let p = Path::new("x");
        assert_eq!(
            decode(b"\xff\xd8\xff broken", p).unwrap_err().code,
            FsErrorCode::UnsupportedImage
        );
        assert_eq!(
            decode(b"hello", p).unwrap_err().code,
            FsErrorCode::UnsupportedImage
        );
        let mut cut = build::jpeg(300, 300, 3);
        cut.truncate(cut.len() / 3);
        // a cut JPEG may decode partly or fail – it must never panic
        let _ = thumbnail_jpeg(&cut, 50, 50, p);
    }

    #[test]
    fn huge_images_are_refused_before_decoding() {
        // a PNG header declaring 20 000 × 20 000 pixels, no pixel data
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        let mut ihdr = b"IHDR".to_vec();
        ihdr.extend_from_slice(&20_000u32.to_be_bytes());
        ihdr.extend_from_slice(&20_000u32.to_be_bytes());
        ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
        png.extend_from_slice(&ihdr[4..]);
        png.extend_from_slice(&crc32fast::hash(&ihdr).to_be_bytes());
        let err = decode(&png, Path::new("x")).unwrap_err();
        assert!(
            matches!(
                err.code,
                FsErrorCode::ArchiveTooLarge | FsErrorCode::UnsupportedImage
            ),
            "{err:?}"
        );
    }
}
