//! Thin Tauri command layer: validate the input, run blocking work on
//! `spawn_blocking`, return `FsError` on failure.
//!
//! Rule (taken over from files-and-folders 029 E11): **commands are never synchronous** –
//! a synchronous command runs on the main thread in Tauri 2 and freezes the window on every
//! slow disk. The test [`command_rules`] checks this.

use crate::book_registry::BookRegistry;
use crate::categories::{self, CategoriesConfig, CategoriesLoaded, Category};
use crate::cover::{self, CoverService, Reply};
use crate::error::{FsError, FsErrorCode};
use crate::legacy_import::{self, LegacyImport};
use crate::model::AppInfo;
use crate::reader::model::{OpenedBook, ReaderEvent};
use crate::reader::{ReaderService, page_cache};
use crate::reading_state::{ReadingPosition, ReadingState};
use crate::scan_hub::{ScanEvent, ScanHub, Target};
use crate::{about, opener, paths, platform, scan_cache};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

/// App-wide state: the categories as last loaded/saved and the running scans.
#[derive(Default)]
pub struct AppState {
    categories: Mutex<Option<CategoriesConfig>>,
    /// One `save_categories` at a time: file and memory stay alike (review 002 #5).
    save_lock: Mutex<()>,
    hub: ScanHub,
    /// Books the scans listed – the only ones the cover scheme serves (design 003 E1).
    registry: Arc<BookRegistry>,
    /// Created on first use (needs the app cache folder).
    covers: OnceLock<Arc<CoverService>>,
    /// Open books of the reader (design 005), created on first use.
    reader: OnceLock<Arc<ReaderService>>,
    /// Reading positions, loaded on first use (design 005 E5); one writer at a time.
    reading: Mutex<Option<ReadingState>>,
}

/// Runs blocking work off the async runtime.
async fn blocking<T, F>(f: F) -> Result<T, FsError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, FsError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| FsError::new(FsErrorCode::Io, e.to_string(), None))?
}

fn io_error(message: impl Into<String>) -> FsError {
    FsError::new(FsErrorCode::Io, message, None)
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, FsError> {
    app.path()
        .app_config_dir()
        .map_err(|e| io_error(e.to_string()))
}

fn cache_dir(app: &AppHandle) -> Result<PathBuf, FsError> {
    app.path()
        .app_cache_dir()
        .map_err(|e| io_error(e.to_string()))
}

/// The categories in memory, loaded from the file on first use.
fn current_categories(app: &AppHandle) -> Result<CategoriesConfig, FsError> {
    let state = app.state::<AppState>();
    let mut guard = state.categories.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(c) = guard.as_ref() {
        return Ok(c.clone());
    }
    let loaded = categories::load(&config_dir(app)?).config;
    *guard = Some(loaded.clone());
    Ok(loaded)
}

fn find_category(app: &AppHandle, id: &str) -> Result<Category, FsError> {
    current_categories(app)?
        .categories
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| FsError::new(FsErrorCode::UnknownCategory, "unknown category", None))
}

#[tauri::command]
pub async fn get_app_info(app: AppHandle) -> Result<AppInfo, FsError> {
    let pkg = app.package_info();
    Ok(about::app_info(&pkg.name, &pkg.version.to_string()))
}

/// `~/Comics` if it exists (suggestion on the first start).
#[tauri::command]
pub async fn default_comics_dir() -> Result<Option<String>, FsError> {
    blocking(|| {
        let comics = paths::home_dir()?.join("Comics");
        Ok(comics
            .is_dir()
            .then(|| comics.to_string_lossy().into_owned()))
    })
    .await
}

#[tauri::command]
pub async fn load_categories(app: AppHandle) -> Result<CategoriesLoaded, FsError> {
    blocking(move || {
        let loaded = categories::load(&config_dir(&app)?);
        let state = app.state::<AppState>();
        *state.categories.lock().unwrap_or_else(|e| e.into_inner()) = Some(loaded.config.clone());
        Ok(loaded)
    })
    .await
}

/// Cleans strictly, writes `categories.json`, removes caches no category needs any more.
#[tauri::command]
pub async fn save_categories(
    app: AppHandle,
    config: CategoriesConfig,
) -> Result<CategoriesConfig, FsError> {
    blocking(move || {
        let state = app.state::<AppState>();
        let _saving = state.save_lock.lock().unwrap_or_else(|e| e.into_inner());
        let saved = categories::save(&config_dir(&app)?, &config)?;
        let before = state
            .categories
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .replace(saved.clone());
        // books of removed categories – or of a category whose folder or types changed – can no
        // longer be asked for (design 003 E1, review 003 #6)
        for old in before.into_iter().flat_map(|c| c.categories) {
            let same = saved.categories.iter().any(|c| {
                c.id == old.id
                    && c.base_dir == old.base_dir
                    && c.book_extensions == old.book_extensions
            });
            if !same {
                state.registry.forget(&old.id);
            }
        }
        // caches of running scans stay – their walk is about to write them (review 002 #6)
        let mut keep: HashSet<String> = state.hub.running_keys();
        keep.extend(
            saved
                .categories
                .iter()
                .map(|c| scan_cache::cache_key(&c.base_dir, &c.book_extensions)),
        );
        if let Ok(dir) = cache_dir(&app) {
            scan_cache::cleanup(&dir, &keep);
        }
        Ok(saved)
    })
    .await
}

/// Native folder dialog (design 002 E1: Rust API of the dialog plugin, no capability).
#[tauri::command]
pub async fn pick_folder(app: AppHandle, start: Option<String>) -> Result<Option<String>, FsError> {
    blocking(move || {
        let mut dialog = app.dialog().file();
        if let Some(dir) = start
            .as_deref()
            .and_then(|s| paths::validate_input_path(s).ok())
            .filter(|p| p.is_dir())
        {
            dialog = dialog.set_directory(dir);
        }
        let Some(picked) = dialog.blocking_pick_folder() else {
            return Ok(None);
        };
        let path = picked
            .into_path()
            .map_err(|_| FsError::new(FsErrorCode::InvalidPath, "not a local folder", None))?;
        let path = paths::validate_input_path(&path.to_string_lossy())?;
        // only an existing folder (E2E: GTK returned a half-typed path, design 002)
        if !path.is_dir() {
            return Err(FsError::new(
                FsErrorCode::NotFound,
                "folder not found",
                Some(&path),
            ));
        }
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
}

/// File dialog for the old `config.json`, then a preview (nothing is saved, design 002 E7).
#[tauri::command]
pub async fn import_legacy_config(app: AppHandle) -> Result<Option<LegacyImport>, FsError> {
    blocking(move || {
        let Some(picked) = app
            .dialog()
            .file()
            .add_filter("JSON", &["json"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = picked
            .into_path()
            .map_err(|_| FsError::new(FsErrorCode::InvalidPath, "not a local file", None))?;
        let existing = current_categories(&app)?.categories;
        legacy_import::import_file(&path, &existing).map(Some)
    })
    .await
}

/// Sends the cached books (if any) and scans the category; everything else comes as events.
#[tauri::command]
pub async fn open_category(
    app: AppHandle,
    id: String,
    on_event: Channel<ScanEvent>,
) -> Result<(), FsError> {
    blocking(move || {
        let category = find_category(&app, &id)?;
        let cache = cache_dir(&app)?;
        let state = app.state::<AppState>();
        let hub = state.hub.clone();
        let registry = state.registry.clone();
        let target = Target {
            base_dir: category.base_dir,
            extensions: category.book_extensions,
        };
        let category_id = id.clone();
        // the registry learns the books first; a closed window just drops the events
        let sink = Arc::new(move |e: ScanEvent| {
            registry.apply(&category_id, &e);
            let _ = on_event.send(e);
        });
        hub.open(&cache, &id, target, sink);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn cancel_scan(app: AppHandle, id: String) -> Result<(), FsError> {
    // takes the hub lock – never on the async runtime (review 002 #10)
    blocking(move || {
        app.state::<AppState>().hub.cancel(&id);
        Ok(())
    })
    .await
}

/// Opens a listed book with the system's default app (design 004 E5).
#[tauri::command]
pub async fn open_book_external(
    app: AppHandle,
    category_id: String,
    book_id: String,
) -> Result<(), FsError> {
    blocking(move || {
        let path = opener::resolve_book(&app.state::<AppState>().registry, &category_id, &book_id)?;
        opener::open_with_default_app(&path)
    })
    .await
}

/// Shows a listed book in Finder / Explorer / the file manager (design 004 E5).
#[tauri::command]
pub async fn reveal_book(
    app: AppHandle,
    category_id: String,
    book_id: String,
) -> Result<(), FsError> {
    blocking(move || {
        let path = opener::resolve_book(&app.state::<AppState>().registry, &category_id, &book_id)?;
        platform::desktop::reveal(&path)
    })
    .await
}

/// Opens a listed book in the reader (design 005): pages, token, the remembered page; sizes
/// and the end of the background pass arrive as events.
#[tauri::command]
pub async fn open_book(
    app: AppHandle,
    category_id: String,
    book_id: String,
    on_event: Channel<ReaderEvent>,
) -> Result<OpenedBook, FsError> {
    blocking(move || {
        let path = opener::resolve_book(&app.state::<AppState>().registry, &category_id, &book_id)?;
        let sink: crate::reader::Sink = Arc::new(move |e| {
            // a closed window just drops the events
            let _ = on_event.send(e);
        });
        let mut opened = reader(&app)?.open(&path, sink)?;
        let pages = opened.pages.len();
        opened.last_page = with_reading(&app, |s| {
            s.books.get(&book_id).map(|p| p.page).filter(|p| *p < pages)
        })?;
        Ok(opened)
    })
    .await
}

/// Closes an open book: its pass stops, its page URLs answer 404.
#[tauri::command]
pub async fn close_book(app: AppHandle, token: String) -> Result<(), FsError> {
    blocking(move || {
        reader(&app)?.close(&token);
        Ok(())
    })
    .await
}

/// Remembers the page of a listed book (design 005 E5).
#[tauri::command]
pub async fn save_reading_position(
    app: AppHandle,
    category_id: String,
    book_id: String,
    page: usize,
    pages: usize,
) -> Result<(), FsError> {
    blocking(move || {
        // only books the scan listed (no keys from the WebView)
        if app
            .state::<AppState>()
            .registry
            .path(&category_id, &book_id)
            .is_none()
        {
            return Err(FsError::new(
                FsErrorCode::UnknownBook,
                "the book is not in the scanned list",
                None,
            ));
        }
        let dir = config_dir(&app)?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_millis() as i64);
        let state = app.state::<AppState>();
        let mut guard = state.reading.lock().unwrap_or_else(|e| e.into_inner());
        let reading = guard.get_or_insert_with(|| ReadingState::load(&dir));
        if reading.set(&book_id, page, pages, now) {
            reading.save(&dir)?;
        }
        Ok(())
    })
    .await
}

/// All remembered positions (for the progress bars of the grid).
#[tauri::command]
pub async fn load_reading_state(
    app: AppHandle,
) -> Result<HashMap<String, ReadingPosition>, FsError> {
    blocking(move || with_reading(&app, |s| s.books.clone())).await
}

/// Full screen on/off (design 005 E11: a command instead of a window permission).
#[tauri::command]
pub async fn toggle_fullscreen(window: tauri::WebviewWindow) -> Result<bool, FsError> {
    let on = !window
        .is_fullscreen()
        .map_err(|e| io_error(e.to_string()))?;
    window
        .set_fullscreen(on)
        .map_err(|e| io_error(e.to_string()))?;
    Ok(on)
}

fn with_reading<T>(app: &AppHandle, f: impl FnOnce(&ReadingState) -> T) -> Result<T, FsError> {
    let dir = config_dir(app)?;
    let state = app.state::<AppState>();
    let mut guard = state.reading.lock().unwrap_or_else(|e| e.into_inner());
    Ok(f(guard.get_or_insert_with(|| ReadingState::load(&dir))))
}

/// The reader service of the app (created on first use).
pub fn reader(app: &AppHandle) -> Result<Arc<ReaderService>, FsError> {
    let state = app.state::<AppState>();
    if let Some(r) = state.reader.get() {
        return Ok(r.clone());
    }
    let dir = cache_dir(app)?;
    Ok(state
        .reader
        .get_or_init(|| ReaderService::new(&dir, page_cache::DEFAULT_LIMIT))
        .clone())
}

/// Handler of the `ccpage` scheme (design 005 E7): runs on a blocking thread.
pub fn serve_page(app: &AppHandle, url_path: &str) -> Reply {
    let Some(req) = crate::reader::url::parse_path(url_path) else {
        return Reply::status(404);
    };
    match reader(app) {
        Ok(r) => r.serve(&req),
        Err(_) => Reply::status(500),
    }
}

/// The cover service of the app (created on first use).
pub fn covers(app: &AppHandle) -> Result<Arc<CoverService>, FsError> {
    let state = app.state::<AppState>();
    if let Some(c) = state.covers.get() {
        return Ok(c.clone());
    }
    let dir = cache_dir(app)?;
    let threads =
        cover::pool::default_threads(std::thread::available_parallelism().map_or(2, |n| n.get()));
    Ok(state
        .covers
        .get_or_init(|| CoverService::new(&dir, threads))
        .clone())
}

/// Handler of the `cccover` scheme (design 003): runs on a blocking thread, answers through
/// `respond` (at once or when the cover pool is done). Only books of the registry, only sizes of
/// the category.
pub fn serve_cover(app: &AppHandle, url_path: &str, respond: Box<dyn FnOnce(Reply) + Send>) {
    let Some(req) = cover::parse_path(url_path) else {
        return respond(Reply::status(404));
    };
    let state = app.state::<AppState>();
    let Some(book) = state.registry.path(&req.category_id, &req.book_id) else {
        return respond(Reply::status(404));
    };
    let dim = current_categories(app).ok().and_then(|c| {
        c.categories
            .into_iter()
            .find(|c| c.id == req.category_id)
            .and_then(|c| c.thumbs_dims.into_iter().nth(req.dim_index))
    });
    let (Some(dim), Ok(service)) = (dim, covers(app)) else {
        return respond(Reply::status(404));
    };
    service.serve(book, &dim, respond);
}

#[cfg(test)]
mod command_rules {
    /// Every `#[tauri::command]` in this file is an `async fn`.
    #[test]
    fn commands_are_async() {
        let src = include_str!("commands.rs");
        let mut lines = src.lines();
        let mut count = 0;
        while let Some(line) = lines.next() {
            if line.trim() == "#[tauri::command]" {
                let next = lines.next().unwrap_or_default().trim();
                assert!(
                    next.starts_with("pub async fn"),
                    "synchronous command: {next}"
                );
                count += 1;
            }
        }
        assert!(count >= 15);
    }
}
