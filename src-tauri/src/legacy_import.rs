//! Import of the old comiccommander `config.json` (design 002 E7).
//!
//! The file is hostile input: at most [`MAX_BYTES`], parsed leniently field by field (a wrong
//! type drops that field or category, never the whole import). Only categories are taken
//! over; `port`, `tempDir`, `apiUrl`, `selectedCategoryIndex`, `scrollOffset` are ignored.
//! Nothing is saved here – the frontend shows a preview and saves through `save_categories`.

use crate::categories::{
    self, Category, DEFAULT_ICON, ICONS, ThumbsDim, is_valid_dim, normalize_extensions,
};
use crate::error::{FsError, FsErrorCode};
use serde::Serialize;
use serde_json::Value;
use std::io::Read;
use std::path::Path;

pub const MAX_BYTES: u64 = 1 << 20;
/// Notes per category (review 002 #1) – the rest is summarised by the last one.
pub const MAX_NOTES_PER_CATEGORY: usize = 10;
/// Longest `detail` of a note.
pub const MAX_DETAIL_CHARS: usize = 40;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NoteCode {
    /// The folder does not exist (now) – imported anyway.
    MissingDir,
    /// An extension we cannot read – left out (detail = the extension).
    UnsupportedExtension,
    /// Same folder and extensions as an existing category – not ticked in the preview.
    Duplicate,
    /// A thumbnail size outside the limits – left out (detail = `w×h`).
    InvalidDims,
    /// `baseDir` missing or not absolute – category left out.
    InvalidDir,
    /// No supported extension left – category left out.
    NoExtension,
    /// The limit of categories is reached – category left out (review 002 #8).
    TooMany,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportNote {
    /// Index into [`LegacyImport::categories`]; `None` for a category that was left out.
    pub index: Option<usize>,
    pub title: String,
    pub code: NoteCode,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyImport {
    pub file: String,
    /// Ids are empty – `save_categories` assigns them.
    pub categories: Vec<Category>,
    pub notes: Vec<ImportNote>,
}

/// Material icon names of the old app → our Font Awesome names (E4).
pub fn map_material_icon(name: &str) -> &'static str {
    let n = name.trim();
    if let Some(i) = ICONS.iter().find(|i| **i == n) {
        return i;
    }
    match n {
        "stars" | "star" | "star_rate" | "grade" => "star",
        "book" | "menu_book" | "auto_stories" | "library_books" | "import_contacts" => "book",
        "bookmark" | "bookmarks" => "bookmark",
        "rocket" | "rocket_launch" => "rocket",
        "flag" => "flag",
        "favorite" | "favorite_border" => "heart",
        "whatshot" | "local_fire_department" => "fire",
        "bolt" | "flash_on" => "bolt",
        "public" | "language" => "globe",
        "school" | "account_balance" => "university",
        "child_care" | "child_friendly" => "child",
        "pets" => "paw",
        "auto_awesome" | "auto_fix_high" => "magic",
        "diamond" => "diamond",
        "emoji_events" => "trophy",
        "movie" | "theaters" | "local_movies" => "film",
        "photo_camera" | "camera_alt" => "camera",
        "music_note" | "library_music" => "music",
        "directions_car" => "car",
        "flight" => "plane",
        "directions_boat" | "sailing" => "ship",
        "park" | "forest" => "tree",
        "dark_mode" | "nightlight" => "moon-o",
        _ => DEFAULT_ICON,
    }
}

fn str_field<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(Value::as_str)
}

fn same_target(a: &Category, b: &Category) -> bool {
    let sorted = |c: &Category| {
        let mut e = c.book_extensions.clone();
        e.sort();
        e
    };
    a.base_dir == b.base_dir && sorted(a) == sorted(b)
}

/// Parses the text of an old config. `dir_exists` decides the `missing_dir` note (tests).
pub fn parse(
    text: &str,
    file: &str,
    existing: &[Category],
    dir_exists: &dyn Fn(&str) -> bool,
) -> Result<LegacyImport, FsError> {
    let invalid =
        |m: &str| FsError::new(FsErrorCode::InvalidLegacyConfig, m, Some(Path::new(file)));
    let root: Value = serde_json::from_str(text).map_err(|_| invalid("not JSON"))?;
    let list = root
        .get("categories")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("no \"categories\" array"))?;
    let mut out = LegacyImport {
        file: file.to_owned(),
        categories: Vec::new(),
        notes: Vec::new(),
    };
    // room left next to the existing categories (review 002 #8)
    let room = categories::MAX_CATEGORIES.saturating_sub(existing.len());
    for raw in list.iter().take(categories::MAX_CATEGORIES) {
        // cut before it is copied into notes (review 002 #1: a long title × many notes)
        let title: String = str_field(raw, "title")
            .unwrap_or_default()
            .trim()
            .chars()
            .take(categories::MAX_TITLE_CHARS)
            .collect();
        let first_note = out.notes.len();
        let note = |out: &mut LegacyImport, index, code, detail: Option<String>| {
            if out.notes.len() - first_note < MAX_NOTES_PER_CATEGORY {
                out.notes.push(ImportNote {
                    index,
                    title: title.clone(),
                    code,
                    detail: detail.map(|d| d.chars().take(MAX_DETAIL_CHARS).collect()),
                });
            }
        };
        if out.categories.len() >= room {
            note(&mut out, None, NoteCode::TooMany, None);
            continue;
        }
        let Some(base_dir) = str_field(raw, "baseDir")
            .and_then(|d| crate::paths::validate_input_path(d).ok())
            .map(|p| p.to_string_lossy().into_owned())
        else {
            note(&mut out, None, NoteCode::InvalidDir, None);
            continue;
        };
        let raw_exts: Vec<String> = raw
            .get("bookExtensions")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        let (exts, bad) = normalize_extensions(&raw_exts);
        let index = out.categories.len();
        if exts.is_empty() {
            note(&mut out, None, NoteCode::NoExtension, None);
            continue;
        }
        let mut dims = Vec::new();
        let mut bad_dims = Vec::new();
        for d in raw
            .get("thumbsDims")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let dim = ThumbsDim {
                width: d
                    .get("width")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    .min(u64::from(u32::MAX)) as u32,
                height: d
                    .get("height")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    .min(u64::from(u32::MAX)) as u32,
                name_extension: str_field(d, "nameExtension").unwrap_or_default().to_owned(),
            };
            if is_valid_dim(&dim) && dims.len() < categories::MAX_DIMS {
                dims.push(dim);
            } else {
                bad_dims.push(format!("{}×{}", dim.width, dim.height));
            }
        }
        let category = Category {
            id: String::new(),
            title: title.clone(),
            base_dir,
            book_extensions: exts,
            icon: map_material_icon(str_field(raw, "icon").unwrap_or_default()).to_owned(),
            thumbs_dims: dims,
            dim_index: raw.get("dimIndex").and_then(Value::as_u64).unwrap_or(0) as usize,
            initial_filter: str_field(raw, "initialFilter")
                .unwrap_or_default()
                .to_owned(),
        };
        // the same cleaning as when loading (title, defaults, limits) – never fails for these
        let Some(mut category) = categories::sanitize_loaded(categories::CategoriesConfig {
            version: categories::VERSION,
            active_id: None,
            categories: vec![category],
        })
        .categories
        .pop() else {
            note(&mut out, None, NoteCode::InvalidDir, None);
            continue;
        };
        category.id.clear();
        for e in bad {
            note(
                &mut out,
                Some(index),
                NoteCode::UnsupportedExtension,
                Some(e),
            );
        }
        for d in bad_dims {
            note(&mut out, Some(index), NoteCode::InvalidDims, Some(d));
        }
        if !dir_exists(&category.base_dir) {
            note(&mut out, Some(index), NoteCode::MissingDir, None);
        }
        if existing
            .iter()
            .chain(out.categories.iter())
            .any(|e| same_target(e, &category))
        {
            note(&mut out, Some(index), NoteCode::Duplicate, None);
        }
        out.categories.push(category);
    }
    Ok(out)
}

/// Reads and parses an old config file (at most [`MAX_BYTES`]).
pub fn import_file(path: &Path, existing: &[Category]) -> Result<LegacyImport, FsError> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .and_then(|f| f.take(MAX_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|e| FsError::from_io(&e, path))?;
    let too_big = bytes.len() as u64 > MAX_BYTES;
    let text = String::from_utf8(bytes)
        .ok()
        .filter(|_| !too_big)
        .ok_or_else(|| {
            FsError::new(
                FsErrorCode::InvalidLegacyConfig,
                "too big or not UTF-8",
                Some(path),
            )
        })?;
    parse(&text, &path.to_string_lossy(), existing, &|d| {
        Path::new(d).is_dir()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("../testdata/legacy-config.json");

    fn fixture(root: &str) -> String {
        FIXTURE.replace("@ROOT@", root)
    }

    #[test]
    fn imports_marcs_config() {
        let r = parse(&fixture("/demo"), "config.json", &[], &|_| true).unwrap();
        assert_eq!(r.categories.len(), 2);
        let comics = &r.categories[0];
        assert_eq!(comics.title, "Comics");
        assert_eq!(comics.base_dir, "/demo/comics");
        assert_eq!(comics.book_extensions, [".cbz", ".cbr"]);
        assert_eq!(comics.icon, "star");
        assert_eq!(comics.dim_index, 1);
        assert_eq!(comics.thumbs_dims, categories::default_thumbs_dims());
        assert!(comics.id.is_empty());
        let make = &r.categories[1];
        assert_eq!(
            (make.title.as_str(), make.base_dir.as_str()),
            ("Make", "/demo/ct Make")
        );
        assert_eq!(make.book_extensions, [".pdf"]);
        assert!(r.notes.is_empty());
    }

    #[test]
    fn notes_for_missing_dirs_and_duplicates() {
        let existing = parse(&fixture("/demo"), "c", &[], &|_| true)
            .unwrap()
            .categories;
        let r = parse(&fixture("/demo"), "c", &existing[..1], &|d| {
            d.ends_with("comics")
        })
        .unwrap();
        let codes: Vec<(Option<usize>, NoteCode)> =
            r.notes.iter().map(|n| (n.index, n.code)).collect();
        assert_eq!(
            codes,
            [
                (Some(0), NoteCode::Duplicate),
                (Some(1), NoteCode::MissingDir)
            ]
        );
    }

    #[test]
    fn hostile_and_odd_values() {
        let text = r#"{ "port": "x", "categories": [
            { "title": "rel", "baseDir": "relative", "bookExtensions": [".cbz"] },
            { "title": "epub", "baseDir": "/a", "bookExtensions": [".epub"] },
            { "title": "mixed", "baseDir": "/b", "bookExtensions": [".CBR", ".epub", 7],
              "icon": "pets", "dimIndex": 7, "initialFilter": "+x",
              "thumbsDims": [ { "width": 99999, "height": 1 }, { "width": 300, "height": 450, "nameExtension": "/x" },
                              { "width": 300, "height": 450 } ] },
            "nonsense"
        ] }"#;
        let r = parse(text, "c", &[], &|_| true).unwrap();
        assert_eq!(r.categories.len(), 1);
        let c = &r.categories[0];
        assert_eq!(c.book_extensions, [".cbr"]);
        assert_eq!(c.icon, "paw");
        assert_eq!(
            c.thumbs_dims,
            vec![ThumbsDim {
                width: 300,
                height: 450,
                name_extension: String::new()
            }]
        );
        assert_eq!(c.dim_index, 0);
        assert_eq!(c.initial_filter, "+x");
        let codes: Vec<NoteCode> = r.notes.iter().map(|n| n.code).collect();
        assert!(codes.contains(&NoteCode::InvalidDir));
        assert!(codes.contains(&NoteCode::NoExtension));
        assert!(codes.contains(&NoteCode::UnsupportedExtension));
        assert_eq!(
            codes
                .iter()
                .filter(|c| **c == NoteCode::InvalidDims)
                .count(),
            2
        );
    }

    #[test]
    fn hostile_file_cannot_blow_up_the_notes() {
        // review 002 #1: a long title cloned into one note per bad extension
        let exts = vec!["\"\""; 150_000].join(",");
        let title = "T".repeat(400_000);
        let text = format!(
            r#"{{ "categories": [ {{ "title": "{title}", "baseDir": "/a", "bookExtensions": [".cbz", {exts}] }} ] }}"#
        );
        assert!(text.len() < MAX_BYTES as usize);
        let r = parse(&text, "c", &[], &|_| true).unwrap();
        assert_eq!(r.categories.len(), 1);
        assert!(r.notes.len() <= MAX_NOTES_PER_CATEGORY);
        let bytes: usize = r
            .notes
            .iter()
            .map(|n| n.title.len() + n.detail.as_ref().map_or(0, String::len))
            .sum();
        assert!(bytes < 10_000, "{bytes}");
        assert!(r.categories[0].title.chars().count() <= categories::MAX_TITLE_CHARS);
    }

    #[test]
    fn respects_the_category_limit_and_duplicates_in_the_file() {
        // review 002 #8
        let one = r#"{ "title": "x", "baseDir": "/a", "bookExtensions": [".cbz"] }"#;
        let text = format!(r#"{{ "categories": [ {one}, {one} ] }}"#);
        let r = parse(&text, "c", &[], &|_| true).unwrap();
        let codes: Vec<_> = r.notes.iter().map(|n| (n.index, n.code)).collect();
        assert_eq!(codes, [(Some(1), NoteCode::Duplicate)]);

        let existing: Vec<Category> = (0..categories::MAX_CATEGORIES - 1)
            .map(|i| Category {
                base_dir: format!("/e{i}"),
                ..r.categories[0].clone()
            })
            .collect();
        let many = (0..3)
            .map(|i| {
                format!(r#"{{ "title": "m{i}", "baseDir": "/m{i}", "bookExtensions": [".cbz"] }}"#)
            })
            .collect::<Vec<_>>()
            .join(",");
        let r = parse(
            &format!(r#"{{ "categories": [ {many} ] }}"#),
            "c",
            &existing,
            &|_| true,
        )
        .unwrap();
        assert_eq!(r.categories.len(), 1);
        assert_eq!(
            r.notes
                .iter()
                .filter(|n| n.code == NoteCode::TooMany)
                .count(),
            2
        );
    }

    #[test]
    fn refuses_non_configs() {
        for text in ["", "[]", "{}", r#"{"categories": 3}"#, "{ broken"] {
            let e = parse(text, "c", &[], &|_| true).unwrap_err();
            assert_eq!(e.code, FsErrorCode::InvalidLegacyConfig, "{text}");
        }
    }

    #[test]
    fn file_size_limit() {
        let dir = tempfile::tempdir().unwrap();
        let big = dir.path().join("big.json");
        std::fs::write(&big, vec![b' '; (MAX_BYTES + 1) as usize]).unwrap();
        assert_eq!(
            import_file(&big, &[]).unwrap_err().code,
            FsErrorCode::InvalidLegacyConfig
        );
        let ok = dir.path().join("config-mac.json");
        let root = dir.path().to_string_lossy().into_owned();
        std::fs::create_dir(dir.path().join("comics")).unwrap();
        std::fs::write(&ok, fixture(&root)).unwrap();
        let r = import_file(&ok, &[]).unwrap();
        assert_eq!(r.categories.len(), 2);
        // "ct Make" does not exist in the temp folder
        assert_eq!(r.notes.len(), 1);
        assert_eq!(
            (r.notes[0].index, r.notes[0].code),
            (Some(1), NoteCode::MissingDir)
        );
    }

    #[test]
    fn material_icons() {
        assert_eq!(map_material_icon("stars"), "star");
        assert_eq!(map_material_icon("menu_book"), "book");
        assert_eq!(map_material_icon("rocket"), "rocket");
        assert_eq!(map_material_icon("unknown_thing"), "book");
    }
}
