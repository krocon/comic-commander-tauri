//! Thin Tauri command layer: validate the input, run blocking work on
//! `spawn_blocking`, return `FsError` on failure.
//!
//! Rule (taken over from files-and-folders 029 E11): **commands are never synchronous** –
//! a synchronous command runs on the main thread in Tauri 2 and freezes the window on every
//! slow disk. The test [`command_rules`] checks this.

use crate::categories::{self, CategoriesConfig, CategoriesLoaded, Category};
use crate::error::{FsError, FsErrorCode};
use crate::legacy_import::{self, LegacyImport};
use crate::model::AppInfo;
use crate::scan_hub::{ScanEvent, ScanHub, Target};
use crate::{about, paths, scan_cache};
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

/// App-wide state: the categories as last loaded/saved and the running scans.
#[derive(Default)]
pub struct AppState {
    categories: Mutex<Option<CategoriesConfig>>,
    hub: ScanHub,
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
        let saved = categories::save(&config_dir(&app)?, &config)?;
        let state = app.state::<AppState>();
        *state.categories.lock().unwrap_or_else(|e| e.into_inner()) = Some(saved.clone());
        let keep: HashSet<String> = saved
            .categories
            .iter()
            .map(|c| scan_cache::cache_key(&c.base_dir, &c.book_extensions))
            .collect();
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
        let hub = app.state::<AppState>().hub.clone();
        let target = Target {
            base_dir: category.base_dir,
            extensions: category.book_extensions,
        };
        // a closed window just drops the events
        let sink = Arc::new(move |e: ScanEvent| {
            let _ = on_event.send(e);
        });
        hub.open(&cache, &id, target, sink);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn cancel_scan(app: AppHandle, id: String) -> Result<(), FsError> {
    app.state::<AppState>().hub.cancel(&id);
    Ok(())
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
        assert!(count >= 8);
    }
}
