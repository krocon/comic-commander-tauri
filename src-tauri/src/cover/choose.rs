//! Which entry of a book is the cover (design 003 E8, legacy §4 improved): images only
//! (`jpg jpeg png webp gif bmp`, any case), no hidden parts, no `__MACOSX`, not empty; then
//! `cover.` in the name first → fewer folder levels → natural order.

use crate::book::Entry;
use crate::scan::natural_cmp;
use std::cmp::Ordering;

pub const IMAGE_EXT: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "bmp"];

fn parts(name: &str) -> impl Iterator<Item = &str> {
    name.split(['/', '\\']).filter(|p| !p.is_empty())
}

/// An image page (not hidden, not macOS resource fork junk).
pub fn is_page(e: &Entry) -> bool {
    if e.size == 0 {
        return false;
    }
    let mut last = "";
    for p in parts(&e.name) {
        if p.starts_with('.') || p == "__MACOSX" {
            return false;
        }
        last = p;
    }
    last.rsplit_once('.').is_some_and(|(stem, ext)| {
        !stem.is_empty() && IMAGE_EXT.contains(&ext.to_ascii_lowercase().as_str())
    })
}

fn depth(name: &str) -> usize {
    parts(name).count()
}

fn sort_key(name: &str) -> String {
    name.replace('\\', "/")
}

/// The pages in reading order (natural order of the names).
pub fn pages(entries: &[Entry]) -> Vec<&Entry> {
    let mut p: Vec<&Entry> = entries.iter().filter(|e| is_page(e)).collect();
    p.sort_by(|a, b| natural_cmp(&sort_key(&a.name), &sort_key(&b.name)));
    p
}

fn cover_order(a: &Entry, b: &Entry) -> Ordering {
    let named = |e: &Entry| !e.name.to_lowercase().contains("cover.");
    named(a)
        .cmp(&named(b))
        .then_with(|| depth(&a.name).cmp(&depth(&b.name)))
        .then_with(|| natural_cmp(&sort_key(&a.name), &sort_key(&b.name)))
}

pub fn cover(entries: &[Entry]) -> Option<&Entry> {
    entries
        .iter()
        .filter(|e| is_page(e))
        .min_by(|a, b| cover_order(a, b))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(name: &str) -> Entry {
        Entry {
            name: name.into(),
            size: 10,
            pos: 0,
            encrypted: false,
        }
    }

    fn pick(names: &[&str]) -> Option<String> {
        let entries: Vec<Entry> = names.iter().map(|n| e(n)).collect();
        cover(&entries).map(|c| c.name.clone())
    }

    #[test]
    fn cover_named_file_wins_even_deep() {
        assert_eq!(
            pick(&["001.jpg", "extras/deep/Cover.JPG"]).as_deref(),
            Some("extras/deep/Cover.JPG")
        );
    }

    #[test]
    fn flatter_before_deeper_then_natural() {
        assert_eq!(
            pick(&["a/001.jpg", "p10.jpg", "p2.jpg"]).as_deref(),
            Some("p2.jpg")
        );
        assert_eq!(
            pick(&["Heft/p10.png", "Heft/p9.webp"]).as_deref(),
            Some("Heft/p9.webp")
        );
    }

    #[test]
    fn junk_is_never_the_cover() {
        let names = [
            "__MACOSX/._Max Friedman 2 – 01.jpg",
            "._001.jpg",
            ".hidden/000.jpg",
            "info.txt",
            "ComicInfo.xml",
            "Max Friedman 2 – 01.jpg",
        ];
        assert_eq!(pick(&names).as_deref(), Some("Max Friedman 2 – 01.jpg"));
        assert_eq!(pick(&["a.txt", ".jpg"]), None);
        let mut empty = e("0.jpg");
        empty.size = 0;
        assert!(cover(&[empty]).is_none());
    }

    #[test]
    fn backslash_separators_and_case() {
        assert_eq!(
            pick(&["sub\\001.JPEG", "002.Gif"]).as_deref(),
            Some("002.Gif")
        );
        assert!(is_page(&e("x\\y.BMP")));
    }

    #[test]
    fn pages_in_reading_order() {
        let entries: Vec<Entry> = [
            "p10.jpg",
            "p2.jpg",
            "P1.jpg",
            "notes.txt",
            "__MACOSX/._p1.jpg",
        ]
        .iter()
        .map(|n| e(n))
        .collect();
        let names: Vec<&str> = pages(&entries).iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["P1.jpg", "p2.jpg", "p10.jpg"]);
    }
}
