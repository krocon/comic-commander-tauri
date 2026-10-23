//! The fast way for scanned PDFs (design 006 E2): a page whose content only places **one**
//! JPEG image over (almost) the whole page – then the JPEG itself is the page, in full quality
//! and without rendering. Strict: any other drawing operator, a rotation, a mask, CMYK, another
//! filter → `None` (render instead).

use hayro::hayro_syntax::Filter;
use hayro::hayro_syntax::content::ops::TypedInstruction;
use hayro::hayro_syntax::object::{Array, Name, Object, Stream};
use hayro::hayro_syntax::page::{Page, Rotation};

/// Part of the page width / height the image must cover.
const COVER: f32 = 0.9;

fn name_is(n: &Name<'_>, s: &[u8]) -> bool {
    n.as_ref() == s
}

fn colour_space_ok(image: &Stream<'_>) -> bool {
    let dict = image.dict();
    if let Some(n) = dict.get::<Name<'_>>(b"ColorSpace") {
        return name_is(&n, b"DeviceRGB") || name_is(&n, b"DeviceGray");
    }
    // [/ICCBased <<… /N 1|3>>]
    if let Some(a) = dict.get::<Array<'_>>(b"ColorSpace") {
        let mut it = a.iter::<Object<'_>>();
        if let (Some(Object::Name(n)), Some(Object::Stream(icc))) = (it.next(), it.next()) {
            let channels = icc.dict().get::<f32>(b"N").unwrap_or(0.0);
            return name_is(&n, b"ICCBased") && (channels == 1.0 || channels == 3.0);
        }
    }
    false
}

/// The JPEG bytes of a page that is just one JPEG, else `None`.
pub fn page_jpeg(page: &Page<'_>) -> Option<Vec<u8>> {
    if !matches!(page.rotation(), Rotation::None) {
        return None;
    }
    let crop = page.intersected_crop_box();
    let (pw, ph) = ((crop.x1 - crop.x0) as f32, (crop.y1 - crop.y0) as f32);
    if pw <= 0.0 || ph <= 0.0 {
        return None;
    }
    // the unit square the image is drawn into: x' = a·x + e, y' = d·y + f (no rotation, no skew)
    let mut stack: Vec<[f32; 4]> = Vec::new();
    let mut m = [1.0f32, 1.0, 0.0, 0.0];
    let mut image: Option<Stream<'_>> = None;
    let mut ops = page.typed_operations();
    while let Some(op) = ops.next() {
        match op {
            TypedInstruction::SaveState(_) => stack.push(m),
            TypedInstruction::RestoreState(_) => m = stack.pop()?,
            TypedInstruction::Transform(t) => {
                let (a, b, c, d) = (t.0.as_f32(), t.1.as_f32(), t.2.as_f32(), t.3.as_f32());
                let (e, f) = (t.4.as_f32(), t.5.as_f32());
                if b.abs() > 1e-3 || c.abs() > 1e-3 || a <= 0.0 || d <= 0.0 {
                    return None;
                }
                // CTM' = cm × CTM
                m = [a * m[0], d * m[1], e * m[0] + m[2], f * m[1] + m[3]];
            }
            TypedInstruction::XObject(x) => {
                if image.is_some() {
                    return None;
                }
                let s = page.resources().get_x_object(x.0)?;
                let d = s.dict();
                let is_image = d
                    .get::<Name<'_>>(b"Subtype")
                    .is_some_and(|n| name_is(&n, b"Image"));
                // the part of the page the image covers, on each axis (review 006 #6)
                let cover = |lo: f32, len: f32, p0: f64, p1: f64| {
                    ((lo + len).min(p1 as f32) - lo.max(p0 as f32)).max(0.0)
                };
                let cx = cover(m[2], m[0], crop.x0, crop.x1);
                let cy = cover(m[3], m[1], crop.y0, crop.y1);
                if !is_image
                    || cx < pw * COVER
                    || cy < ph * COVER
                    || d.contains_key(b"SMask")
                    || d.contains_key(b"Mask")
                    || d.contains_key(b"Decode")
                    || d.get::<bool>(b"ImageMask").unwrap_or(false)
                    || s.filters().as_slice() != [Filter::DctDecode]
                    || !colour_space_ok(&s)
                {
                    return None;
                }
                image = Some(s);
            }
            _ => return None,
        }
    }
    let data = image?.raw_data().into_owned();
    usable(&data).then_some(data)
}

/// A JPEG the WebView and the thumbnailer show right: grey or RGB (CMYK/YCCK need the PDF's
/// colour handling), within the pixel limits (review 006 #5).
pub fn usable(data: &[u8]) -> bool {
    use crate::cover::image::{MAX_PIXELS, MAX_SIDE};
    use image::ImageDecoder;
    if !data.starts_with(&[0xFF, 0xD8, 0xFF]) {
        return false;
    }
    let Ok(d) = image::codecs::jpeg::JpegDecoder::new(std::io::Cursor::new(data)) else {
        return false;
    };
    let (w, h) = d.dimensions();
    matches!(
        d.color_type(),
        image::ColorType::L8 | image::ColorType::Rgb8
    ) && w > 0
        && h > 0
        && w <= MAX_SIDE
        && h <= MAX_SIDE
        && u64::from(w) * u64::from(h) <= MAX_PIXELS
}
