//! Check of a PDF before hayro draws anything (review 006 #1): hayro decodes streams without a
//! size limit – a few KB of stacked Flate can become many GB, and running out of memory aborts
//! the process (no `catch_unwind` helps). So every stream is decoded here once, through its
//! expanding filters (Flate, LZW, RunLength, ASCIIHex, ASCII85), **with a limit per layer**;
//! image XObjects must declare a size within the pixel limits of 003, and a JPEG's own header
//! must agree. Anything over a limit refuses the whole PDF (`archive_too_large`).
//!
//! Left open (design 006 „Restrisiko“): inline images (`BI … ID … EI`) inside a content stream
//! are not checked here – the content stream itself is bounded by [`MAX_STREAM`].

use crate::book::Budget;
use crate::cover::image::{MAX_PIXELS, MAX_SIDE};
use crate::error::{FsError, FsErrorCode};
use hayro::hayro_syntax::Filter;
use hayro::hayro_syntax::Pdf;
use hayro::hayro_syntax::object::{Name, Object, Stream};
use std::io::Read;
use std::path::Path;

/// Largest decoded size of one stream (per filter layer). A 64 MP RGB image is 192 MB.
pub const MAX_STREAM: usize = 256 << 20;

fn too_large(message: impl Into<String>, path: &Path) -> FsError {
    FsError::new(FsErrorCode::ArchiveTooLarge, message, Some(path))
}

/// Outcome of one decoding layer.
enum Layer {
    Data(Vec<u8>),
    /// Broken data: hayro will fail on it as well – nothing to fear.
    Broken,
    TooLarge,
}

fn inflate(data: &[u8]) -> Layer {
    let mut out = Vec::new();
    let zlib = flate2::read::ZlibDecoder::new(data)
        .take(MAX_STREAM as u64 + 1)
        .read_to_end(&mut out);
    if zlib.is_err() || out.is_empty() {
        out.clear();
        // hayro also tries raw deflate
        if flate2::read::DeflateDecoder::new(data)
            .take(MAX_STREAM as u64 + 1)
            .read_to_end(&mut out)
            .is_err()
            && out.is_empty()
        {
            return Layer::Broken;
        }
    }
    if out.len() > MAX_STREAM {
        Layer::TooLarge
    } else {
        Layer::Data(out)
    }
}

/// PDF LZW (MSB first, 9…12 bit codes, 256 clear, 257 end), with a size limit.
fn lzw(data: &[u8], early_change: bool) -> Layer {
    let mut out: Vec<u8> = Vec::new();
    let mut table: Vec<Vec<u8>> = Vec::new();
    let reset = |t: &mut Vec<Vec<u8>>| {
        t.clear();
        t.extend((0..=255u8).map(|b| vec![b]));
        t.push(Vec::new());
        t.push(Vec::new());
    };
    reset(&mut table);
    let (mut bits, mut acc, mut nbits) = (9u32, 0u32, 0u32);
    let mut prev: Option<Vec<u8>> = None;
    for &byte in data {
        acc = (acc << 8) | u32::from(byte);
        nbits += 8;
        while nbits >= bits {
            let code = ((acc >> (nbits - bits)) & ((1 << bits) - 1)) as usize;
            nbits -= bits;
            if code == 256 {
                reset(&mut table);
                bits = 9;
                prev = None;
                continue;
            }
            if code == 257 {
                return Layer::Data(out);
            }
            let entry = match (table.get(code), &prev) {
                (Some(e), _) if code < table.len() && (code < 256 || !e.is_empty()) => e.clone(),
                (_, Some(p)) if code == table.len() => {
                    let mut e = p.clone();
                    e.push(p[0]);
                    e
                }
                _ => return Layer::Broken,
            };
            if out.len() + entry.len() > MAX_STREAM {
                return Layer::TooLarge;
            }
            out.extend_from_slice(&entry);
            if let Some(p) = prev.take()
                && table.len() < 4096
            {
                let mut e = p;
                e.push(entry[0]);
                table.push(e);
            }
            prev = Some(entry);
            let next = table.len() + usize::from(early_change);
            bits = if next >= 2048 {
                12
            } else if next >= 1024 {
                11
            } else if next >= 512 {
                10
            } else {
                9
            };
        }
    }
    Layer::Data(out)
}

fn run_length(data: &[u8]) -> Layer {
    let mut out = Vec::new();
    let mut i = 0;
    while i < data.len() {
        let n = data[i] as usize;
        i += 1;
        match n {
            128 => break,
            0..=127 => {
                let end = (i + n + 1).min(data.len());
                out.extend_from_slice(&data[i..end]);
                i = end;
            }
            _ => {
                let Some(&b) = data.get(i) else { break };
                out.resize(out.len() + 257 - n, b);
                i += 1;
            }
        }
        if out.len() > MAX_STREAM {
            return Layer::TooLarge;
        }
    }
    Layer::Data(out)
}

fn hex(data: &[u8]) -> Layer {
    let digits: Vec<u8> = data
        .iter()
        .take_while(|b| **b != b'>')
        .filter_map(|b| (*b as char).to_digit(16).map(|d| d as u8))
        .collect();
    Layer::Data(
        digits
            .chunks(2)
            .map(|c| (c[0] << 4) | c.get(1).copied().unwrap_or(0))
            .collect(),
    )
}

fn ascii85(data: &[u8]) -> Layer {
    let mut out = Vec::new();
    let mut group: Vec<u32> = Vec::with_capacity(5);
    for &b in data {
        match b {
            b'~' => break,
            b'z' if group.is_empty() => out.extend_from_slice(&[0; 4]),
            b'!'..=b'u' => {
                group.push(u32::from(b - b'!'));
                if group.len() == 5 {
                    let v = group
                        .iter()
                        .fold(0u32, |a, d| a.wrapping_mul(85).wrapping_add(*d));
                    out.extend_from_slice(&v.to_be_bytes());
                    group.clear();
                }
            }
            _ => {}
        }
    }
    if !group.is_empty() {
        let n = group.len();
        group.resize(5, 84);
        let v = group
            .iter()
            .fold(0u32, |a, d| a.wrapping_mul(85).wrapping_add(*d));
        out.extend_from_slice(&v.to_be_bytes()[..n - 1]);
    }
    Layer::Data(out)
}

fn number(s: &Stream<'_>, key: &[u8]) -> Option<f64> {
    s.dict().get::<f64>(key)
}

/// Declared size of an image XObject, and the JPEG header of a `DCTDecode` image.
fn check_image(s: &Stream<'_>, path: &Path) -> Result<(), FsError> {
    let is_image = s
        .dict()
        .get::<Name<'_>>(b"Subtype")
        .is_some_and(|n| n.as_ref() == b"Image");
    if !is_image {
        return Ok(());
    }
    let (w, h) = (
        number(s, b"Width").unwrap_or(0.0),
        number(s, b"Height").unwrap_or(0.0),
    );
    let side = f64::from(MAX_SIDE);
    if !(w.is_finite() && h.is_finite()) || w > side || h > side || w * h > MAX_PIXELS as f64 {
        return Err(too_large(
            format!("an image of the PDF is too large ({w} × {h})"),
            path,
        ));
    }
    if s.filters().first() == Some(&Filter::DctDecode) {
        let raw = s.raw_data();
        if let Some((jw, jh)) = crate::reader::image::dimensions(&raw)
            && (jw > MAX_SIDE || jh > MAX_SIDE || u64::from(jw) * u64::from(jh) > MAX_PIXELS)
        {
            return Err(too_large(
                format!("a JPEG of the PDF is too large ({jw} × {jh})"),
                path,
            ));
        }
    }
    Ok(())
}

/// Decodes the expanding filters of `s` with limits.
fn check_stream(s: &Stream<'_>, path: &Path) -> Result<(), FsError> {
    check_image(s, path)?;
    let filters = s.filters();
    if filters.is_empty() {
        return Ok(());
    }
    let early_change = s
        .dict()
        .get::<hayro::hayro_syntax::object::Dict<'_>>(b"DecodeParms")
        .and_then(|d| d.get::<f64>(b"EarlyChange"))
        .is_none_or(|v| v != 0.0);
    let mut data = s.raw_data().into_owned();
    for f in filters {
        let layer = match f {
            Filter::FlateDecode => inflate(&data),
            Filter::LzwDecode => lzw(&data, early_change),
            Filter::RunLengthDecode => run_length(&data),
            Filter::AsciiHexDecode => hex(&data),
            Filter::Ascii85Decode => ascii85(&data),
            // image codecs: their output size is the checked image size
            _ => return Ok(()),
        };
        data = match layer {
            Layer::Data(d) => d,
            Layer::Broken => return Ok(()),
            Layer::TooLarge => {
                return Err(too_large(
                    format!(
                        "a stream of the PDF unpacks to more than {} MiB",
                        MAX_STREAM >> 20
                    ),
                    path,
                ));
            }
        };
    }
    Ok(())
}

/// Checks every stream of `pdf` (blocking; `budget` = time limit).
pub fn check(pdf: &Pdf, path: &Path, budget: &Budget<'_>) -> Result<(), FsError> {
    for obj in pdf.objects() {
        budget.check(path)?;
        if let Object::Stream(s) = obj {
            check_stream(&s, path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn deflate(data: &[u8]) -> Vec<u8> {
        let mut e = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::best());
        e.write_all(data).unwrap();
        e.finish().unwrap()
    }

    #[test]
    fn decoders_round_trip_and_stop_at_the_limit() {
        let Layer::Data(d) = inflate(&deflate(b"hallo hallo")) else {
            panic!()
        };
        assert_eq!(d, b"hallo hallo");
        // a bomb: 300 MiB of zeros in ~300 KB, twice deflated is a few hundred bytes
        let big = vec![0u8; MAX_STREAM + 1024];
        let once = deflate(&big);
        assert!(matches!(inflate(&once), Layer::TooLarge));
        let twice = deflate(&once);
        assert!(twice.len() < 4096, "{}", twice.len());
        let Layer::Data(inner) = inflate(&twice) else {
            panic!()
        };
        assert!(matches!(inflate(&inner), Layer::TooLarge));
        assert!(matches!(inflate(b"not deflate"), Layer::Broken));
        let Layer::Data(h) = hex(b"48 61 6C6c6F>") else {
            panic!()
        };
        assert_eq!(h, b"Hallo");
        let Layer::Data(a) = ascii85(b"87cURD]i,\"Ebo80~>") else {
            panic!()
        };
        assert_eq!(a, b"Hello World!");
        let Layer::Data(r) = run_length(&[2, b'a', b'b', b'c', 254, b'x', 128]) else {
            panic!()
        };
        assert_eq!(r, b"abcxxx");
        assert!(matches!(
            run_length(&[129, 0].repeat(3_000_000)),
            Layer::TooLarge
        ));
    }

    #[test]
    fn lzw_of_the_pdf_reference() {
        // PDF 32000-1 §7.4.4.2 example: "-----A---B" → 80 0B 60 50 22 0C 0C 85 01
        let Layer::Data(d) = lzw(
            &[0x80, 0x0B, 0x60, 0x50, 0x22, 0x0C, 0x0C, 0x85, 0x01],
            true,
        ) else {
            panic!()
        };
        assert_eq!(d, b"-----A---B");
        assert!(matches!(lzw(&[0xFF, 0xFF, 0xFF], true), Layer::Broken));
    }
}
