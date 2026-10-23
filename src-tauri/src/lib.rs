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
//! - [`opener`]        open a listed book with the default app (design 004 E5, from files-and-folders)
//! - [`platform`]      OS functions with one signature each: `desktop::reveal` (design 004 E5)
//! - [`pdf`]           PDF books: pages, sizes, fast way for scans, rendering with hayro (design 006)
//! - [`reader`]        open books, pages in reading order, page cache, scheme `ccpage` (design 005)
//! - [`reading_state`] last page per book in `reading-state.json` (design 005 E5)
//! - [`jobs`]          slim job engine (one run per kind, cancel, pause, throttled events); missing covers (design 007)
//! - [`app_menu`]      native menu bar of macOS from the frontend's menu model (design 008)
//! - [`keymap_file`]   the user's shortcut overrides `keymap.json` (design 008 E2)
//! - [`about`]         data for the About dialog (version, platform)
//! - [`commands`]      thin Tauri command layer (validate, `spawn_blocking`, never synchronous)

pub mod about;
pub mod app_menu;
pub mod book;
pub mod book_registry;
pub mod categories;
pub mod commands;
pub mod config_file;
pub mod cover;
pub mod error;
pub mod fs_atomic;
pub mod jobs;
pub mod keymap_file;
pub mod legacy_import;
pub mod model;
pub mod opener;
pub mod paths;
pub mod pdf;
pub mod platform;
pub mod reader;
pub mod reading_state;
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
        // never sniffed into something else (design 005 E7)
        .header("X-Content-Type-Options", "nosniff")
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
        // pages of the reader (design 005 E7): blocking threads, the reader limits the work
        .register_asynchronous_uri_scheme_protocol(
            reader::url::SCHEME,
            |ctx, request, responder| {
                let app = ctx.app_handle().clone();
                let path = request.uri().path().to_owned();
                tauri::async_runtime::spawn_blocking(move || {
                    responder.respond(http_reply(commands::serve_page(&app, &path)));
                });
            },
        )
        // native menu (macOS, design 008): a click is an action of the frontend
        .on_menu_event(|app, event| {
            use tauri::Emitter;
            let id = event.id().0.clone();
            if app_menu::valid_id(&id) {
                let _ = app.emit(app_menu::EVENT, app_menu::MenuAction { id });
            }
        })
        .setup(|app| {
            // trim the cover cache once per start, in the background
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Ok(c) = commands::covers(&handle) {
                    c.trim_cache();
                }
                // pages unpacked in earlier sessions (design 005 E1)
                if let Ok(r) = commands::reader(&handle) {
                    r.trim_cache();
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
            commands::open_book_external,
            commands::reveal_book,
            commands::open_book,
            commands::close_book,
            commands::save_reading_position,
            commands::load_reading_state,
            commands::toggle_fullscreen,
            commands::start_generate_thumbs,
            commands::pause_job,
            commands::cancel_job,
            commands::set_app_menu,
            commands::load_keymap_overrides,
            commands::quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
