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
    let (pw, ph) = page.base_dimensions();
    // scale of the unit square the image is drawn into
    let mut stack: Vec<(f32, f32)> = Vec::new();
    let (mut sx, mut sy) = (1.0f32, 1.0f32);
    let mut image: Option<Stream<'_>> = None;
    let mut ops = page.typed_operations();
    while let Some(op) = ops.next() {
        match op {
            TypedInstruction::SaveState(_) => stack.push((sx, sy)),
            TypedInstruction::RestoreState(_) => (sx, sy) = stack.pop()?,
            TypedInstruction::Transform(t) => {
                let (a, b, c, d) = (t.0.as_f32(), t.1.as_f32(), t.2.as_f32(), t.3.as_f32());
                if b.abs() > 1e-3 || c.abs() > 1e-3 || a <= 0.0 || d <= 0.0 {
                    return None;
                }
                sx *= a;
                sy *= d;
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
                if !is_image
                    || sx < pw * COVER
                    || sy < ph * COVER
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
    data.starts_with(&[0xFF, 0xD8, 0xFF]).then_some(data)
}
