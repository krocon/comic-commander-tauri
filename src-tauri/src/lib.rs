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
//! - [`book`]          comic books by content: ZIP/RAR/7z/TAR, list + one entry with limits (design 003)
//! - [`cover`]         cover choice, decoder, sidecars, disk cache, LIFO pool, scheme `cccover` (design 003)
//! - [`book_registry`] which books the scans listed – the only ones covers are served for
//! - [`about`]         data for the About dialog (version, platform)
//! - [`commands`]      thin Tauri command layer (validate, `spawn_blocking`, never synchronous)

pub mod about;
pub mod book;
pub mod book_registry;
pub mod categories;
pub mod commands;
pub mod config_file;
pub mod cover;
pub mod error;
pub mod fs_atomic;
pub mod legacy_import;
pub mod model;
pub mod paths;
pub mod scan;
pub mod scan_cache;
pub mod scan_hub;

/// The HTTP answer of the cover scheme: images are immutable (the URL holds the book's mtime).
fn http_reply(reply: cover::Reply) -> tauri::http::Response<Vec<u8>> {
    let cache = if reply.status == 200 {
        "public, max-age=31536000, immutable"
    } else {
        "no-store"
    };
    tauri::http::Response::builder()
        .status(reply.status)
        .header(tauri::http::header::CONTENT_TYPE, reply.mime)
        .header(tauri::http::header::CACHE_CONTROL, cache)
        .body(reply.body)
        .unwrap_or_else(|_| {
            let mut r = tauri::http::Response::new(Vec::new());
            *r.status_mut() = tauri::http::StatusCode::INTERNAL_SERVER_ERROR;
            r
        })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // only the Rust API is used (pick_folder, import_legacy_config) – the WebView gets no
        // `dialog:` permission (design 002 E1)
        .plugin(tauri_plugin_dialog::init())
        .manage(commands::AppState::default())
        // covers (design 003): asynchronous scheme, the work runs on blocking threads / the pool
        .register_asynchronous_uri_scheme_protocol(cover::SCHEME, |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let path = request.uri().path().to_owned();
            tauri::async_runtime::spawn_blocking(move || {
                commands::serve_cover(
                    &app,
                    &path,
                    Box::new(move |reply| responder.respond(http_reply(reply))),
                );
            });
        })
        .setup(|app| {
            // trim the cover cache once per start, in the background
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Ok(c) = commands::covers(&handle) {
                    c.trim_cache();
                }
            });
            Ok(())
        })
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
