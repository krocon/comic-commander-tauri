//! Comic Commander – Tauri backend.
//!
//! Module overview:
//! - [`error`]    structured, serialisable errors (`FsError { code, message, path }`)
//! - [`model`]    DTOs shared with the Angular frontend (keep in sync with `src/app/core/library/library.models.ts`)
//! - [`paths`]    validation of paths coming from the frontend (`~`, absolute, no NUL)
//! - [`library`]  recursive scan of a library folder for comic books (pure, unit-tested, no Tauri)
//! - [`about`]    data for the About dialog (version, platform)
//! - [`commands`] thin Tauri command layer (validate, `spawn_blocking`, never synchronous)

pub mod about;
pub mod commands;
pub mod error;
pub mod library;
pub mod model;
pub mod paths;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::default_library_root,
            commands::scan_library,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
