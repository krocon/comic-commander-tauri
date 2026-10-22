//! Comic Commander – Tauri backend.
//!
//! Module overview:
//! - [`error`]         structured, serialisable errors (`FsError { code, message, path }`)
//! - [`model`]         DTOs shared with the frontend (`src/app/core/scan/scan.models.ts`, `about.models.ts`)
//! - [`paths`]         validation of paths coming from the frontend (`~`, absolute, no NUL)
//! - [`categories`]    the user's categories (`categories.json`): sanitize, ids, icons, extensions (design 002)
//! - [`legacy_import`] import of the old comiccommander `config.json` (design 002 E7)
//! - [`scan`]          recursive walk of a category's `baseDir` (pure, cancellable)
//! - [`scan_cache`]    scan results in the app cache, diff (design 002 E5)
//! - [`scan_hub`]      one scan per target on worker threads, events to subscribers (design 002 E9)
//! - [`config_file`], [`fs_atomic`] loader of small config files / atomic writes (from files-and-folders)
//! - [`about`]         data for the About dialog (version, platform)
//! - [`commands`]      thin Tauri command layer (validate, `spawn_blocking`, never synchronous)

pub mod about;
pub mod categories;
pub mod commands;
pub mod config_file;
pub mod error;
pub mod fs_atomic;
pub mod legacy_import;
pub mod model;
pub mod paths;
pub mod scan;
pub mod scan_cache;
pub mod scan_hub;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // only the Rust API is used (pick_folder, import_legacy_config) – the WebView gets no
        // `dialog:` permission (design 002 E1)
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::default_comics_dir,
            commands::load_categories,
            commands::save_categories,
            commands::pick_folder,
            commands::import_legacy_config,
            commands::open_category,
            commands::cancel_scan,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
