//! Thin Tauri command layer: validate the input, run blocking work on
//! `spawn_blocking`, return `FsError` on failure.
//!
//! Rule (taken over from files-and-folders 029 E11): **commands are never synchronous** –
//! a synchronous command runs on the main thread in Tauri 2 and freezes the window on every
//! slow disk. The test [`command_rules`] checks this.

use crate::error::{FsError, FsErrorCode};
use crate::model::{AppInfo, LibraryScan};
use crate::{about, library, paths};
use tauri::AppHandle;

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

#[tauri::command]
pub async fn get_app_info(app: AppHandle) -> AppInfo {
    let pkg = app.package_info();
    about::app_info(&pkg.name, &pkg.version.to_string())
}

/// `~/Comics` if it exists, otherwise the home folder.
#[tauri::command]
pub async fn default_library_root() -> Result<String, FsError> {
    blocking(|| {
        let home = paths::home_dir()?;
        let comics = home.join("Comics");
        let root = if comics.is_dir() { comics } else { home };
        Ok(root.to_string_lossy().into_owned())
    })
    .await
}

/// Scans a library folder recursively for comic books (prompt 001; caching → prompt 002).
#[tauri::command]
pub async fn scan_library(root: String) -> Result<LibraryScan, FsError> {
    let root = paths::validate_input_path(&root)?;
    blocking(move || library::scan(&root)).await
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
        assert!(count >= 3);
    }
}
