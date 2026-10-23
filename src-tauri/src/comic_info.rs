//! `ComicInfo.xml` (ComicRack standard) of a book (design 011 E1, E3): which entry it is, reading
//! it with limits, and the few fields Comic Commander uses. Pure – no Tauri.
//!
//! The file is hostile input: at most [`MAX_XML`] bytes, read with the [`Budget`] of a cover
//! (time limit, skip limit for solid books, cancel flag). `quick-xml` is a pull parser without
//! DTD or external entities; references other than the five predefined ones and character
//! references are dropped. Invalid XML gives **no** fields (fail-closed, no half results).

use crate::book::{self, Budget, Container, Entry};
use crate::error::{FsError, FsErrorCode};
use crate::scan::natural_cmp;
use quick_xml::Reader;
use quick_xml::events::Event;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::atomic::AtomicBool;

/// Largest `ComicInfo.xml` read (real ones: 1–5 KiB).
pub const MAX_XML: u64 = 1 << 20;
/// Longest text field kept (characters, not bytes).
pub const MAX_TEXT: usize = 200;
/// Longest `Number` kept (characters).
pub const MAX_NUMBER: usize = 16;
/// Deepest element nesting accepted – ComicInfo is two levels deep.
pub const MAX_DEPTH: usize = 32;
/// Raw text collected per field at most (before cleaning).
const MAX_RAW: usize = 4096;

/// `Manga` of ComicInfo: `No`, `Yes`, `YesAndRightToLeft` (design 011 E11).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Manga {
    No,
    Yes,
    /// `YesAndRightToLeft`.
    Rtl,
}

/// What a book says about itself. All fields optional; an empty value (`BookMeta::default()`)
/// means: read, nothing found (no ComicInfo, PDF, broken, encrypted …).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookMeta {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub series: Option<String>,
    /// As written (`1`, `01`, `1.5`, `12a`) – the frontend orders it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number: Option<String>,
    /// 0…9999.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// 1000…2999.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub year: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub writer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publisher: Option<String>,
    /// 1…100 000.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_count: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manga: Option<Manga>,
}

/// Name segments; `.` and `..` are no names (`tar -cf b.cbt .` stores `./ComicInfo.xml`, review 011 #4).
fn parts(name: &str) -> impl Iterator<Item = &str> {
    name.split(['/', '\\'])
        .filter(|p| !p.is_empty() && *p != "." && *p != "..")
}

/// The `ComicInfo.xml` of a book: base name without case, nothing hidden, not under
/// `__MACOSX`; of several the one with the fewest folder levels, then natural order.
pub fn find(entries: &[Entry]) -> Option<&Entry> {
    entries
        .iter()
        .filter(|e| {
            let mut last = "";
            for p in parts(&e.name) {
                if p.starts_with('.') || p == "__MACOSX" {
                    return false;
                }
                last = p;
            }
            last.eq_ignore_ascii_case("comicinfo.xml")
        })
        .min_by(|a, b| {
            parts(&a.name)
                .count()
                .cmp(&parts(&b.name).count())
                .then_with(|| natural_cmp(&a.name, &b.name))
        })
}

/// Reads the metadata of `path` (blocking). PDF: empty without opening it further.
/// A missing or too large `ComicInfo.xml`: empty. Errors as `book::` gives them.
pub fn read_book(path: &Path, cancel: Option<&AtomicBool>) -> Result<BookMeta, FsError> {
    if book::detect(path)? == Container::Pdf {
        return Ok(BookMeta::default());
    }
    let budget = Budget::new(book::TIME_LIMIT, cancel);
    let (container, entries) = book::list(path, &budget)?;
    let Some(entry) = find(&entries) else {
        return Ok(BookMeta::default());
    };
    if entry.size > MAX_XML {
        return Ok(BookMeta::default());
    }
    let data = book::read(path, container, entry, MAX_XML, &budget)?;
    budget.check(path)?;
    Ok(parse(&data))
}

/// The outcome the scan keeps (design 011 E3): `Some` = read (maybe empty), also for failures a
/// retry cannot change and for the time limit (a book that needs > 20 s would cost every later
/// scan 20 s again – review 011 #5; it is read again when the file changes); `None` = try again
/// with the next scan (I/O, cancel, panic).
pub fn outcome(path: &Path, cancel: Option<&AtomicBool>) -> Option<BookMeta> {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| read_book(path, cancel)));
    let cancelled = || cancel.is_some_and(|c| c.load(std::sync::atomic::Ordering::Relaxed));
    match result {
        Ok(Ok(meta)) => Some(meta),
        Ok(Err(e)) if lasting(e.code) => Some(BookMeta::default()),
        Ok(Err(e)) if e.code == FsErrorCode::Timeout && !cancelled() => Some(BookMeta::default()),
        _ => None,
    }
}

/// Failures that stay as long as the file does (as `cover::remembered`).
fn lasting(code: FsErrorCode) -> bool {
    use FsErrorCode as C;
    matches!(
        code,
        C::UnsupportedFormat
            | C::UnsupportedImage
            | C::ArchiveError
            | C::ArchiveEncrypted
            | C::ArchiveTooLarge
            | C::NoImage
    )
}

/// The bytes as text: BOM UTF-8 / UTF-16 LE/BE (also UTF-16 without BOM), a Latin-1 / cp1252
/// declaration as Latin-1, else UTF-8 (invalid sequences become U+FFFD).
fn decode(data: &[u8]) -> String {
    let utf16 = |bytes: &[u8], le: bool| {
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|c| {
                if le {
                    u16::from_le_bytes([c[0], c[1]])
                } else {
                    u16::from_be_bytes([c[0], c[1]])
                }
            })
            .collect();
        String::from_utf16_lossy(&units)
    };
    match data {
        [0xEF, 0xBB, 0xBF, rest @ ..] => String::from_utf8_lossy(rest).into_owned(),
        [0xFF, 0xFE, rest @ ..] => utf16(rest, true),
        [0xFE, 0xFF, rest @ ..] => utf16(rest, false),
        [b'<', 0, ..] => utf16(data, true),
        [0, b'<', ..] => utf16(data, false),
        _ => {
            let head = String::from_utf8_lossy(&data[..data.len().min(200)]).to_ascii_lowercase();
            let decl = head.find("?>").map_or("", |end| &head[..end]);
            let latin1 = decl.starts_with("<?xml")
                && [
                    "iso-8859-1",
                    "iso8859-1",
                    "latin1",
                    "latin-1",
                    "windows-1252",
                    "cp1252",
                ]
                .iter()
                .any(|e| decl.contains(&format!("\"{e}\"")) || decl.contains(&format!("'{e}'")));
            if latin1 {
                // as browsers do: ISO-8859-1 is read as windows-1252 (review 011 #6)
                data.iter().map(|&b| cp1252(b)).collect()
            } else {
                String::from_utf8_lossy(data).into_owned()
            }
        }
    }
}

/// windows-1252: 0x80–0x9F are typographic characters (– ’ € …), the rest is Latin-1.
fn cp1252(b: u8) -> char {
    const HIGH: [char; 32] = [
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8D}', 'Ž',
        '\u{8F}', '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9D}',
        'ž', 'Ÿ',
    ];
    match b {
        0x80..=0x9F => HIGH[(b - 0x80) as usize],
        _ => b as char,
    }
}

/// Without control characters, white space collapsed, trimmed, at most `max` characters.
fn clean(raw: &str, max: usize) -> Option<String> {
    let mut out = String::new();
    for word in raw
        .split(|c: char| c.is_whitespace() || c.is_control())
        .filter(|w| !w.is_empty())
    {
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(word);
    }
    let out: String = out.chars().take(max).collect();
    let out = out.trim_end().to_owned();
    (!out.is_empty()).then_some(out)
}

fn int_in(raw: &str, lo: i64, hi: i64) -> Option<i64> {
    raw.trim()
        .parse::<i64>()
        .ok()
        .filter(|n| (lo..=hi).contains(n))
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Field {
    Series,
    Number,
    Volume,
    Title,
    Year,
    Writer,
    Publisher,
    PageCount,
    Manga,
}

fn field(name: &str) -> Option<Field> {
    let n = name.to_ascii_lowercase();
    Some(match n.as_str() {
        "series" => Field::Series,
        "number" => Field::Number,
        "volume" => Field::Volume,
        "title" => Field::Title,
        "year" => Field::Year,
        "writer" => Field::Writer,
        "publisher" => Field::Publisher,
        "pagecount" => Field::PageCount,
        "manga" => Field::Manga,
        _ => return None,
    })
}

fn set(meta: &mut BookMeta, f: Field, raw: &str) {
    // the first non-empty value of a field wins
    match f {
        Field::Series if meta.series.is_none() => meta.series = clean(raw, MAX_TEXT),
        Field::Number if meta.number.is_none() => meta.number = clean(raw, MAX_NUMBER),
        Field::Volume if meta.volume.is_none() => {
            meta.volume = int_in(raw, 0, 9999).map(|n| n as i32)
        }
        Field::Title if meta.title.is_none() => meta.title = clean(raw, MAX_TEXT),
        Field::Year if meta.year.is_none() => meta.year = int_in(raw, 1000, 2999).map(|n| n as i32),
        Field::Writer if meta.writer.is_none() => meta.writer = clean(raw, MAX_TEXT),
        Field::Publisher if meta.publisher.is_none() => meta.publisher = clean(raw, MAX_TEXT),
        Field::PageCount if meta.page_count.is_none() => {
            meta.page_count = int_in(raw, 1, 100_000).map(|n| n as u32)
        }
        Field::Manga if meta.manga.is_none() => {
            meta.manga = match raw.trim().to_ascii_lowercase().as_str() {
                "no" => Some(Manga::No),
                "yes" => Some(Manga::Yes),
                "yesandrighttoleft" => Some(Manga::Rtl),
                _ => None,
            }
        }
        _ => {}
    }
}

fn predefined(name: &str) -> Option<char> {
    Some(match name {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        _ => return None,
    })
}

/// The fields of a `ComicInfo.xml` (direct children of the root `ComicInfo`, any case).
/// Anything wrong – not XML, other root, too deep, too large – gives no fields at all.
pub fn parse(data: &[u8]) -> BookMeta {
    if data.len() as u64 > MAX_XML {
        return BookMeta::default();
    }
    parse_text(&decode(data)).unwrap_or_default()
}

fn parse_text(text: &str) -> Option<BookMeta> {
    let mut reader = Reader::from_str(text);
    let config = reader.config_mut();
    config.check_end_names = true;
    config.expand_empty_elements = false;
    let mut meta = BookMeta::default();
    let mut depth = 0usize;
    let mut root_seen = false;
    // the field being read (depth 2) and its raw text
    let mut current: Option<(Field, String)> = None;
    loop {
        match reader.read_event().ok()? {
            Event::Start(e) => {
                depth += 1;
                if depth > MAX_DEPTH {
                    return None;
                }
                if depth == 1 {
                    if root_seen || !e.local_name().as_ref().eq_ignore_ascii_case("comicinfo") {
                        return None;
                    }
                    root_seen = true;
                } else if depth == 2 {
                    current = field(e.local_name().as_ref()).map(|f| (f, String::new()));
                }
            }
            Event::Empty(e) => {
                if depth == 0 {
                    // `<ComicInfo/>`: valid, nothing in it
                    if root_seen || !e.local_name().as_ref().eq_ignore_ascii_case("comicinfo") {
                        return None;
                    }
                    root_seen = true;
                }
            }
            Event::End(_) => {
                if depth == 2
                    && let Some((f, raw)) = current.take()
                {
                    set(&mut meta, f, &raw);
                }
                depth = depth.checked_sub(1)?;
            }
            Event::Text(t) if depth == 2 => {
                if let Some((_, raw)) = &mut current
                    && raw.len() < MAX_RAW
                {
                    raw.push_str(&t.xml10_content());
                }
            }
            Event::CData(t) if depth == 2 => {
                if let Some((_, raw)) = &mut current
                    && raw.len() < MAX_RAW
                {
                    raw.push_str(&t.xml10_content());
                }
            }
            Event::GeneralRef(r) if depth == 2 => {
                if let Some((_, raw)) = &mut current
                    && raw.len() < MAX_RAW
                {
                    let c = if r.is_char_ref() {
                        r.resolve_char_ref().ok().flatten()
                    } else {
                        predefined(&r.xml10_content())
                    };
                    if let Some(c) = c {
                        raw.push(c);
                    }
                }
            }
            Event::Eof => break,
            // declaration, comments, PIs, DOCTYPE (never expanded), text outside the fields
            _ => {}
        }
    }
    (root_seen && depth == 0).then_some(meta)
}

#[cfg(test)]
mod tests;
