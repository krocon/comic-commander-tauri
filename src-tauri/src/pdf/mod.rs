//! PDF books (design 006): pages counted and sized, the cover and the reader's pages as
//! images – with `hayro` (pure Rust, no external program, E1). Scanned PDFs go the fast way:
//! the embedded JPEG of a page is the page (E2, [`fast`]). Everything else is rendered on the
//! render threads ([`render`], E3) with pixel and time limits. A PDF is hostile like any book:
//! size, page count and output pixels are bounded, failures are codes, never a crash.

pub mod fast;
pub mod guard;
pub mod render;

use crate::cover::image::{MAX_PIXELS, MAX_SIDE};
use crate::error::{FsError, FsErrorCode};
use hayro::hayro_interpret::InterpreterSettings;
use hayro::hayro_syntax::{LoadPdfError, Pdf};
use hayro::vello_cpu::color::palette::css::WHITE;
use hayro::{PixmapSettings, RenderCache, RenderSettings};
use image::RgbImage;
use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, UNIX_EPOCH};

/// Largest PDF read (it is held in memory while open).
pub const MAX_FILE: u64 = 1 << 30;
/// Most pages.
pub const MAX_PAGES: usize = 10_000;
/// Time a page may take to render.
pub const RENDER_TIME: Duration = Duration::from_secs(20);
/// Width of a page asked for without a width (the original).
pub const DEFAULT_WIDTH: u32 = 2048;
/// Time the stream check of a PDF may take ([`guard`]).
pub const CHECK_TIME: Duration = Duration::from_secs(60);
/// Largest page side in points accepted (PDF allows 14 400 × UserUnit; posters fit).
pub const MAX_PAGE_POINTS: f32 = 200_000.0;
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
        check_once(&pdf, path)?;
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
        let sizes: Vec<(f32, f32)> = pdf.pages().iter().map(|p| p.render_dimensions()).collect();
        // a page of infinite or absurd size cannot be laid out or rendered (review 006 #2, #7)
        if sizes.iter().any(|(w, h)| {
            !(w.is_finite() && h.is_finite())
                || *w <= 0.0
                || *h <= 0.0
                || w.max(*h) > MAX_PAGE_POINTS
        }) {
            return Err(broken("a page of the PDF has an impossible size", path));
        }
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
    /// within the pixel limits; `None` when the page would be less than a pixel (review 006 #2:
    /// no floor that undoes the limits).
    fn scale(w: f32, h: f32, width: u32, height: Option<u32>) -> Option<f32> {
        let mut s = width as f32 / w;
        if let Some(hh) = height {
            s = s.min(hh as f32 / h);
        }
        let side = MAX_SIDE as f32;
        s = s.min(side / w).min(side / h);
        let pixels = (w * s) * (h * s);
        if pixels > MAX_PIXELS as f32 {
            s *= (MAX_PIXELS as f32 / pixels).sqrt() * 0.999;
        }
        (s.is_finite() && s > 0.0 && w * s >= 1.0 && h * s >= 1.0).then_some(s)
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
        let s = Self::scale(w, h, width, height).ok_or_else(|| {
            broken(
                "the PDF page is too small or too large to render",
                &self.path,
            )
        })?;
        // the pixmap hayro allocates: checked before it exists
        let (ow, oh) = ((w * s).ceil(), (h * s).ceil());
        if ow > MAX_SIDE as f32 || oh > MAX_SIDE as f32 || ow * oh > MAX_PIXELS as f32 * 1.01 {
            return Err(broken("the PDF page is too large to render", &self.path));
        }
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
        let mut rgb = Vec::with_capacity(pw as usize * ph as usize * 3);
        for px in rgba.as_chunks::<4>().0 {
            rgb.extend_from_slice(&px[..3]);
        }
        RgbImage::from_raw(pw, ph, rgb).ok_or_else(|| broken("bad render size", &self.path))
    }
}

/// PDFs whose streams passed [`guard::check`] (path, size, mtime) – the check decodes every
/// stream and is not repeated for every cover size and reader session.
fn check_once(pdf: &Pdf, path: &Path) -> Result<(), FsError> {
    static CHECKED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    let key = std::fs::metadata(path)
        .map(|m| {
            let ms = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map_or(0, |d| d.as_millis());
            format!("{}\0{}\0{ms}", path.to_string_lossy(), m.len())
        })
        .unwrap_or_default();
    let set = CHECKED.get_or_init(|| Mutex::new(HashSet::new()));
    if set.lock().unwrap_or_else(|e| e.into_inner()).contains(&key) {
        return Ok(());
    }
    let budget = crate::book::Budget::new(CHECK_TIME, None);
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        guard::check(pdf, path, &budget)
    }))
    .unwrap_or_else(|_| Err(broken("the PDF cannot be read (check failure)", path)))?;
    let mut set = set.lock().unwrap_or_else(|e| e.into_inner());
    if set.len() > 10_000 {
        set.clear();
    }
    set.insert(key);
    Ok(())
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
    // the embedded JPEG, unless it cannot be used – then rendering (review 006 #5)
    if let Some(data) = book.page_jpeg(0)
        && let Ok(thumb) = crate::cover::image::thumbnail_jpeg(&data, width, height, path)
    {
        return Ok(thumb);
    }
    let img = render_page(&book, 0, width, Some(height))?;
    jpeg(&img, crate::cover::image::QUALITY, path)
}

#[cfg(test)]
pub(crate) mod tests;
