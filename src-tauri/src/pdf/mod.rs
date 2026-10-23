//! PDF books (design 006): pages counted and sized, the cover and the reader's pages as
//! images – with `hayro` (pure Rust, no external program, E1). Scanned PDFs go the fast way:
//! the embedded JPEG of a page is the page (E2, [`fast`]). Everything else is rendered on the
//! render threads ([`render`], E3) with pixel and time limits. A PDF is hostile like any book:
//! size, page count and output pixels are bounded, failures are codes, never a crash.

pub mod fast;
pub mod render;

use crate::cover::image::{MAX_PIXELS, MAX_SIDE};
use crate::error::{FsError, FsErrorCode};
use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::{LoadPdfError, Pdf};
use hayro::vello_cpu::color::palette::css::WHITE;
use hayro::{PixmapSettings, RenderCache, RenderSettings};
use image::RgbImage;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

/// Largest PDF read (it is held in memory while open).
pub const MAX_FILE: u64 = 1 << 30;
/// Most pages.
pub const MAX_PAGES: usize = 10_000;
/// Time a page may take to render.
pub const RENDER_TIME: Duration = Duration::from_secs(20);
/// Width of a page asked for without a width (the original).
pub const DEFAULT_WIDTH: u32 = 2048;
/// JPEG quality of rendered pages (reader) – covers use the thumbnail quality of 003.
pub const QUALITY: u8 = 90;

/// An open PDF: parsed once, shared by the pages of a reader session.
pub struct PdfBook {
    pub path: PathBuf,
    pdf: Pdf,
    /// Render size per page in points (rotation applied).
    pub sizes: Vec<(f32, f32)>,
}

fn broken(message: impl Into<String>, path: &Path) -> FsError {
    FsError::new(FsErrorCode::ArchiveError, message, Some(path))
}

impl PdfBook {
    /// Reads and parses `path` (blocking).
    pub fn open(path: &Path) -> Result<Arc<PdfBook>, FsError> {
        let file = std::fs::File::open(path).map_err(|e| FsError::from_io(&e, path))?;
        let mut data = Vec::new();
        file.take(MAX_FILE + 1)
            .read_to_end(&mut data)
            .map_err(|e| FsError::from_io(&e, path))?;
        if data.len() as u64 > MAX_FILE {
            return Err(FsError::new(
                FsErrorCode::ArchiveTooLarge,
                format!("PDF larger than {} MiB", MAX_FILE >> 20),
                Some(path),
            ));
        }
        let parsed = std::panic::catch_unwind(|| Pdf::new(data))
            .map_err(|_| broken("the PDF cannot be read (parser failure)", path))?;
        let pdf = parsed.map_err(|e| match e {
            LoadPdfError::Decryption(_) => FsError::new(
                FsErrorCode::ArchiveEncrypted,
                "the PDF is protected by a password",
                Some(path),
            ),
            LoadPdfError::Invalid => broken("broken PDF", path),
        })?;
        let n = pdf.pages().len();
        if n == 0 {
            return Err(FsError::new(
                FsErrorCode::NoImage,
                "the PDF has no pages",
                Some(path),
            ));
        }
        if n > MAX_PAGES {
            return Err(FsError::new(
                FsErrorCode::ArchiveTooLarge,
                format!("more than {MAX_PAGES} pages"),
                Some(path),
            ));
        }
        let sizes = pdf.pages().iter().map(|p| p.render_dimensions()).collect();
        Ok(Arc::new(PdfBook {
            path: path.to_path_buf(),
            pdf,
            sizes,
        }))
    }

    pub fn page_count(&self) -> usize {
        self.sizes.len()
    }

    /// The embedded JPEG of a scanned page (E2), if the page is just that.
    pub fn page_jpeg(&self, index: usize) -> Option<Vec<u8>> {
        let page = self.pdf.pages().get(index)?;
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| fast::page_jpeg(page)))
            .ok()
            .flatten()
    }

    /// Scale for a page of `w` × `h` points: `width` px wide (and at most `height` px high),
    /// within the pixel limits.
    fn scale(w: f32, h: f32, width: u32, height: Option<u32>) -> f32 {
        let mut s = width as f32 / w;
        if let Some(hh) = height {
            s = s.min(hh as f32 / h);
        }
        let side = MAX_SIDE as f32;
        s = s.min(side / w).min(side / h);
        let pixels = (w * s) * (h * s);
        if pixels > MAX_PIXELS as f32 {
            s *= (MAX_PIXELS as f32 / pixels).sqrt();
        }
        s.max(0.001)
    }

    /// Renders page `index` (blocking, on the calling thread – use [`render_page`]).
    fn render_now(
        &self,
        index: usize,
        width: u32,
        height: Option<u32>,
    ) -> Result<RgbImage, FsError> {
        let page = self
            .pdf
            .pages()
            .get(index)
            .ok_or_else(|| FsError::new(FsErrorCode::NotFound, "no such page", None))?;
        let (w, h) = self.sizes[index];
        let s = Self::scale(w, h, width, height);
        let pixmap = hayro::render(
            page,
            &RenderCache::new(),
            &InterpreterSettings::default(),
            &RenderSettings::default(),
            &PixmapSettings {
                x_scale: s,
                y_scale: s,
                bg_color: WHITE,
            },
        );
        let (pw, ph) = (u32::from(pixmap.width()), u32::from(pixmap.height()));
        if pw == 0 || ph == 0 {
            return Err(broken("the PDF page is empty", &self.path));
        }
        // white background: every pixel is opaque, premultiplied = straight
        let rgba = pixmap.data_as_u8_slice();
        let mut rgb = Vec::with_capacity((pw * ph * 3) as usize);
        for px in rgba.chunks_exact(4) {
            rgb.extend_from_slice(&px[..3]);
        }
        RgbImage::from_raw(pw, ph, rgb).ok_or_else(|| broken("bad render size", &self.path))
    }
}

/// Renders page `index` of `book` on a render thread (time limit, E3).
pub fn render_page(
    book: &Arc<PdfBook>,
    index: usize,
    width: u32,
    height: Option<u32>,
) -> Result<RgbImage, FsError> {
    let b = book.clone();
    render::run(RENDER_TIME, move || b.render_now(index, width, height)).map_err(|mut e| {
        if e.path.is_none() {
            e.path = Some(book.path.to_string_lossy().into_owned());
        }
        e
    })
}

fn jpeg(img: &RgbImage, quality: u8, path: &Path) -> Result<Vec<u8>, FsError> {
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality)
        .encode_image(img)
        .map_err(|e| broken(format!("no JPEG ({e})"), path))?;
    Ok(out)
}

/// The image of a page for the reader (E5): the embedded JPEG of a scan, else rendered
/// `width` px wide (0 → [`DEFAULT_WIDTH`]) as JPEG.
pub fn page_image(book: &Arc<PdfBook>, index: usize, width: u32) -> Result<Vec<u8>, FsError> {
    if index >= book.page_count() {
        return Err(FsError::new(FsErrorCode::NotFound, "no such page", None));
    }
    if let Some(data) = book.page_jpeg(index) {
        return Ok(data);
    }
    let w = if width == 0 { DEFAULT_WIDTH } else { width };
    jpeg(&render_page(book, index, w, None)?, QUALITY, &book.path)
}

/// The cover of a PDF (E6): page 1 inside `width` × `height`, JPEG.
pub fn thumbnail(path: &Path, width: u32, height: u32) -> Result<Vec<u8>, FsError> {
    let book = PdfBook::open(path)?;
    if let Some(data) = book.page_jpeg(0) {
        return crate::cover::image::thumbnail_jpeg(&data, width, height, path);
    }
    let img = render_page(&book, 0, width, Some(height))?;
    jpeg(&img, crate::cover::image::QUALITY, path)
}

#[cfg(test)]
pub(crate) mod tests;
