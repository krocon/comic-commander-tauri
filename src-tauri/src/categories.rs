//! Categories (design 002): the user's comic folders, as in the old comiccommander config –
//! `baseDir`, `bookExtensions`, `title`, `icon`, `thumbsDims`, `dimIndex`, `initialFilter`
//! (E10), plus an `id`. Stored in `categories.json` in the app config folder.
//!
//! Pure – no Tauri. Two ways to clean a config:
//! - [`sanitize_loaded`] (reading the file): lenient, repairs or drops what is wrong;
//! - [`sanitize_for_save`] (from the frontend): strict, refuses with `invalid_categories`.
//!
//! Keep the lists [`SUPPORTED_EXTENSIONS`] and [`ICONS`] in sync with
//! `src/app/features/categories/category-form.ts` (a spec compares them).

use crate::config_file::{self, ConfigWarning};
use crate::error::{FsError, FsErrorCode};
use crate::fs_atomic::write_atomic;
use crate::paths::validate_input_path;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

pub const FILE_NAME: &str = "categories.json";
pub const VERSION: u32 = 1;
pub const MAX_FILE_BYTES: u64 = 1 << 20;
pub const MAX_CATEGORIES: usize = 50;
pub const MAX_TITLE_CHARS: usize = 100;
pub const MAX_FILTER_CHARS: usize = 500;
pub const MAX_DIMS: usize = 5;
pub const MIN_PX: u32 = 32;
pub const MAX_PX: u32 = 2000;
pub const MAX_SUFFIX_CHARS: usize = 20;

/// Extensions the app can read (E3), with dot, lower case.
pub const SUPPORTED_EXTENSIONS: &[&str] = &[
    ".cbz", ".cbr", ".cb7", ".cbt", ".pdf", ".zip", ".rar", ".7z", ".tar",
];
/// Default of a new category.
pub const DEFAULT_EXTENSIONS: &[&str] = &[".cbz", ".cbr", ".cb7", ".cbt", ".pdf"];

/// Font Awesome 4.5.0 names without `fa-` (E4).
pub const ICONS: &[&str] = &[
    "book",
    "star",
    "bookmark",
    "rocket",
    "flag",
    "heart",
    "fire",
    "bolt",
    "globe",
    "university",
    "child",
    "user-secret",
    "paw",
    "magic",
    "diamond",
    "trophy",
    "film",
    "camera",
    "music",
    "car",
    "plane",
    "ship",
    "tree",
    "moon-o",
];
pub const DEFAULT_ICON: &str = "book";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbsDim {
    pub width: u32,
    pub height: u32,
    /// Suffix of the old sidecar thumbnails (`""` → `Band.jpg`, `"_xl"` → `Band_xl.jpg`).
    #[serde(default)]
    pub name_extension: String,
}

impl ThumbsDim {
    fn new(width: u32, height: u32, name_extension: &str) -> Self {
        Self {
            width,
            height,
            name_extension: name_extension.to_owned(),
        }
    }
}

/// The default sizes of the old comiccommander config.
pub fn default_thumbs_dims() -> Vec<ThumbsDim> {
    vec![
        ThumbsDim::new(200, 300, ""),
        ThumbsDim::new(800, 1200, "_xl"),
    ]
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    /// `c` + 12 hex digits; empty = new (the backend assigns one).
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    pub base_dir: String,
    #[serde(default)]
    pub book_extensions: Vec<String>,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub thumbs_dims: Vec<ThumbsDim>,
    #[serde(default)]
    pub dim_index: usize,
    #[serde(default)]
    pub initial_filter: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoriesConfig {
    #[serde(default = "version")]
    pub version: u32,
    #[serde(default)]
    pub active_id: Option<String>,
    #[serde(default)]
    pub categories: Vec<Category>,
}

fn version() -> u32 {
    VERSION
}

impl Default for CategoriesConfig {
    fn default() -> Self {
        Self {
            version: VERSION,
            active_id: None,
            categories: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoriesLoaded {
    pub config: CategoriesConfig,
    pub warning: Option<ConfigWarning>,
}

/// A new, unique id (`c` + 12 hex digits).
pub fn new_id() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos() as u64);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let mut h = fnv64(&nanos.to_le_bytes());
    h ^= fnv64(&n.to_le_bytes()).rotate_left(17) ^ u64::from(std::process::id());
    format!("c{:012x}", h & 0xffff_ffff_ffff)
}

/// FNV-1a, 64 bit – stable across Rust versions (cache keys, ids).
pub fn fnv64(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

fn is_valid_id(id: &str) -> bool {
    id.len() == 13
        && id.starts_with('c')
        && id[1..]
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// `" CBR"`, `"cbr"`, `".Cbr"` → `".cbr"`; `None` if not supported.
pub fn normalize_extension(raw: &str) -> Option<String> {
    let t = raw.trim().to_ascii_lowercase();
    let t = if t.starts_with('.') {
        t
    } else {
        format!(".{t}")
    };
    SUPPORTED_EXTENSIONS.contains(&t.as_str()).then_some(t)
}

/// Supported extensions in the given order, without duplicates, and the rejected raw values.
pub fn normalize_extensions(raw: &[String]) -> (Vec<String>, Vec<String>) {
    let mut ok: Vec<String> = Vec::new();
    let mut bad = Vec::new();
    for r in raw {
        match normalize_extension(r) {
            Some(e) if !ok.contains(&e) => ok.push(e),
            Some(_) => {}
            None => bad.push(r.clone()),
        }
    }
    (ok, bad)
}

/// A thumbnail size within the limits, with a harmless sidecar suffix.
pub fn is_valid_dim(d: &ThumbsDim) -> bool {
    let px = MIN_PX..=MAX_PX;
    px.contains(&d.width)
        && px.contains(&d.height)
        && d.name_extension.chars().count() <= MAX_SUFFIX_CHARS
        && !d
            .name_extension
            .chars()
            .any(|c| c == '/' || c == '\\' || c.is_control() || c == ':')
}

pub fn map_icon(icon: &str) -> String {
    let i = icon.trim();
    if ICONS.contains(&i) {
        i.to_owned()
    } else {
        DEFAULT_ICON.to_owned()
    }
}

fn truncate_chars(s: &str, max: usize) -> String {
    s.trim().chars().take(max).collect()
}

/// The last segment of the folder (title proposal).
pub fn folder_title(base_dir: &str) -> String {
    Path::new(base_dir)
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "Comics".to_owned())
}

/// Cleans one category. `strict` = refuse instead of repair.
fn sanitize_category(c: &Category, strict: bool) -> Result<Category, String> {
    let base_dir = validate_input_path(&c.base_dir)
        .map_err(|_| format!("folder {:?} is not an absolute path", c.base_dir))?
        .to_string_lossy()
        .into_owned();
    let (mut exts, bad) = normalize_extensions(&c.book_extensions);
    if strict && !bad.is_empty() {
        return Err(format!("unsupported extensions {bad:?}"));
    }
    if exts.is_empty() {
        if strict {
            return Err("no extension".into());
        }
        exts = DEFAULT_EXTENSIONS.iter().map(|e| (*e).to_owned()).collect();
    }
    let mut dims: Vec<ThumbsDim> = Vec::new();
    for d in &c.thumbs_dims {
        if is_valid_dim(d) {
            if dims.len() < MAX_DIMS {
                dims.push(d.clone());
            } else if strict {
                return Err("too many thumbnail sizes".into());
            }
        } else if strict {
            return Err(format!("invalid thumbnail size {}×{}", d.width, d.height));
        }
    }
    if dims.is_empty() {
        if strict && !c.thumbs_dims.is_empty() {
            return Err("no thumbnail size".into());
        }
        dims = default_thumbs_dims();
    }
    let dim_index = if c.dim_index < dims.len() {
        c.dim_index
    } else if strict {
        return Err("dimIndex out of range".into());
    } else {
        0
    };
    let mut title = truncate_chars(&c.title, MAX_TITLE_CHARS);
    if title.is_empty() {
        title = truncate_chars(&folder_title(&base_dir), MAX_TITLE_CHARS);
    }
    Ok(Category {
        id: c.id.clone(),
        title,
        base_dir,
        book_extensions: exts,
        icon: map_icon(&c.icon),
        thumbs_dims: dims,
        dim_index,
        initial_filter: truncate_chars(&c.initial_filter, MAX_FILTER_CHARS),
    })
}

fn finish(categories: Vec<Category>, active_id: Option<String>) -> CategoriesConfig {
    let mut seen = HashSet::new();
    let categories: Vec<Category> = categories
        .into_iter()
        .map(|mut c| {
            if !is_valid_id(&c.id) || !seen.insert(c.id.clone()) {
                c.id = new_id();
                seen.insert(c.id.clone());
            }
            c
        })
        .collect();
    let active_id = active_id
        .filter(|id| categories.iter().any(|c| &c.id == id))
        .or_else(|| categories.first().map(|c| c.id.clone()));
    CategoriesConfig {
        version: VERSION,
        active_id,
        categories,
    }
}

/// Lenient: invalid categories are dropped, the rest repaired.
pub fn sanitize_loaded(cfg: CategoriesConfig) -> CategoriesConfig {
    let cats = cfg
        .categories
        .iter()
        .filter_map(|c| sanitize_category(c, false).ok())
        .take(MAX_CATEGORIES)
        .collect();
    finish(cats, cfg.active_id)
}

/// Strict: the first problem refuses the whole config (`invalid_categories`).
pub fn sanitize_for_save(cfg: &CategoriesConfig) -> Result<CategoriesConfig, FsError> {
    if cfg.categories.len() > MAX_CATEGORIES {
        return Err(invalid(format!("more than {MAX_CATEGORIES} categories")));
    }
    let mut cats = Vec::with_capacity(cfg.categories.len());
    for (i, c) in cfg.categories.iter().enumerate() {
        cats.push(sanitize_category(c, true).map_err(|m| invalid(format!("category {i}: {m}")))?);
    }
    Ok(finish(cats, cfg.active_id.clone()))
}

fn invalid(message: String) -> FsError {
    FsError::new(FsErrorCode::InvalidCategories, message, None)
}

/// Reads `categories.json` (missing → empty, broken → `.bad` + warning).
pub fn load(config_dir: &Path) -> CategoriesLoaded {
    let loaded = config_file::read_config(
        &config_dir.join(FILE_NAME),
        MAX_FILE_BYTES,
        CategoriesConfig::default,
        |text| {
            serde_json::from_str::<CategoriesConfig>(text)
                .map(sanitize_loaded)
                .map_err(|e| e.to_string())
        },
    );
    CategoriesLoaded {
        config: loaded.value,
        warning: loaded.warning,
    }
}

/// Cleans strictly and writes atomically; returns what was written.
pub fn save(config_dir: &Path, cfg: &CategoriesConfig) -> Result<CategoriesConfig, FsError> {
    let clean = sanitize_for_save(cfg)?;
    let file = config_dir.join(FILE_NAME);
    let json = serde_json::to_vec_pretty(&clean)
        .map_err(|e| FsError::new(FsErrorCode::Io, e.to_string(), None))?;
    write_atomic(&file, &json).map_err(|e| FsError::from_io(&e, &file))?;
    Ok(clean)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A Unix-style absolute test path; on Windows on drive C: (`/x` is not absolute there).
    fn abs(p: &str) -> String {
        if cfg!(windows) && p.starts_with('/') {
            format!("C:{p}")
        } else {
            p.to_owned()
        }
    }

    fn cat(base_dir: &str, exts: &[&str]) -> Category {
        Category {
            id: String::new(),
            title: String::new(),
            base_dir: abs(base_dir),
            book_extensions: exts.iter().map(|e| (*e).to_owned()).collect(),
            icon: String::new(),
            thumbs_dims: Vec::new(),
            dim_index: 0,
            initial_filter: String::new(),
        }
    }

    fn cfg(cats: Vec<Category>) -> CategoriesConfig {
        CategoriesConfig {
            version: 1,
            active_id: None,
            categories: cats,
        }
    }

    #[test]
    fn normalizes_extensions() {
        let raw: Vec<String> = ["CBR", ".cbz", " .Pdf ", "cbr", ".epub", "zip"]
            .iter()
            .map(|s| (*s).to_owned())
            .collect();
        let (ok, bad) = normalize_extensions(&raw);
        assert_eq!(ok, [".cbr", ".cbz", ".pdf", ".zip"]);
        assert_eq!(bad, [".epub"]);
    }

    #[test]
    fn save_fills_defaults_ids_and_title() {
        let c = sanitize_for_save(&cfg(vec![cat("/data/Hägar Comics", &[".cbz"])])).unwrap();
        let x = &c.categories[0];
        assert!(is_valid_id(&x.id));
        assert_eq!(x.title, "Hägar Comics");
        assert_eq!(x.icon, "book");
        assert_eq!(x.thumbs_dims, default_thumbs_dims());
        assert_eq!(c.active_id.as_deref(), Some(x.id.as_str()));
    }

    #[test]
    fn save_is_strict() {
        let cases = [
            cat("relative/dir", &[".cbz"]),
            cat("/x", &[]),
            cat("/x", &[".epub"]),
            Category {
                thumbs_dims: vec![ThumbsDim::new(10, 300, "")],
                ..cat("/x", &[".cbz"])
            },
            Category {
                thumbs_dims: vec![ThumbsDim::new(200, 300, "../x")],
                ..cat("/x", &[".cbz"])
            },
            Category {
                dim_index: 2,
                ..cat("/x", &[".cbz"])
            },
        ];
        for c in cases {
            let e = sanitize_for_save(&cfg(vec![c.clone()])).unwrap_err();
            assert_eq!(e.code, FsErrorCode::InvalidCategories, "{c:?}");
        }
        let many = (0..=MAX_CATEGORIES).map(|_| cat("/x", &[".cbz"])).collect();
        assert!(sanitize_for_save(&cfg(many)).is_err());
    }

    #[test]
    fn load_is_lenient() {
        let c = sanitize_loaded(cfg(vec![
            cat("relative", &[".cbz"]),
            Category {
                icon: "stars".into(),
                dim_index: 9,
                thumbs_dims: vec![ThumbsDim::new(1, 1, ""), ThumbsDim::new(200, 300, "")],
                title: "  T ".into(),
                ..cat("/ok", &[".epub"])
            },
        ]));
        assert_eq!(c.categories.len(), 1);
        let x = &c.categories[0];
        assert_eq!(x.title, "T");
        assert_eq!(x.icon, "book");
        assert_eq!(x.dim_index, 0);
        assert_eq!(x.thumbs_dims, vec![ThumbsDim::new(200, 300, "")]);
        assert_eq!(x.book_extensions.len(), DEFAULT_EXTENSIONS.len());
    }

    #[test]
    fn ids_stay_unique_and_active_id_valid() {
        let mut a = cat("/a", &[".cbz"]);
        a.id = "c0123456789ab".into();
        let mut b = cat("/b", &[".cbz"]);
        b.id = a.id.clone();
        let mut config = cfg(vec![a, b]);
        config.active_id = Some("c0123456789ab".into());
        let c = sanitize_for_save(&config).unwrap();
        assert_eq!(c.categories[0].id, "c0123456789ab");
        assert_ne!(c.categories[1].id, c.categories[0].id);
        assert_eq!(c.active_id.as_deref(), Some("c0123456789ab"));
        config.active_id = Some("gone".into());
        assert_eq!(
            sanitize_for_save(&config).unwrap().active_id,
            Some("c0123456789ab".into())
        );
    }

    #[test]
    fn long_texts_are_cut() {
        let c = Category {
            title: "ä".repeat(150),
            initial_filter: "x".repeat(600),
            ..cat("/x", &[".cbz"])
        };
        let x = sanitize_for_save(&cfg(vec![c]))
            .unwrap()
            .categories
            .remove(0);
        assert_eq!(x.title.chars().count(), MAX_TITLE_CHARS);
        assert_eq!(x.initial_filter.chars().count(), MAX_FILTER_CHARS);
    }

    #[test]
    fn save_and_load_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load(dir.path()).config, CategoriesConfig::default());
        let saved = save(dir.path(), &cfg(vec![cat("/c/ö", &["cbr"])])).unwrap();
        let loaded = load(dir.path());
        assert_eq!(loaded.config, saved);
        assert!(loaded.warning.is_none());
        let json = std::fs::read_to_string(dir.path().join(FILE_NAME)).unwrap();
        assert!(json.contains("\"baseDir\"") && json.contains("\"bookExtensions\""));
        assert!(json.contains("\"thumbsDims\"") && json.contains("\"nameExtension\""));
    }

    #[test]
    fn broken_file_is_kept_aside() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(FILE_NAME), "{ nope").unwrap();
        let loaded = load(dir.path());
        assert_eq!(loaded.config, CategoriesConfig::default());
        assert_eq!(loaded.warning.unwrap().code, "broken");
        assert!(dir.path().join("categories.json.bad").exists());
    }

    #[test]
    fn new_ids_differ() {
        let ids: HashSet<String> = (0..1000).map(|_| new_id()).collect();
        assert_eq!(ids.len(), 1000);
        assert!(ids.iter().all(|i| is_valid_id(i)));
    }
}
