//! "Show in Finder/Explorer/file manager" (design 004 E5). One function per OS with the same
//! signature; the path comes from the [`crate::book_registry::BookRegistry`]. Programs get
//! argument arrays with absolute program paths – nothing goes to a shell. This is the narrow
//! exception to "no external programs" (CLAUDE.md §4).
//!
//! Übernommen aus files-and-folders-tauri `platform/desktop.rs` und `tools.rs` (Design 011 E2),
//! gekürzt auf `reveal` (ohne Terminal).

use crate::error::{FsError, FsErrorCode};
use std::io;
use std::path::Path;
#[cfg(not(target_os = "macos"))]
use std::process::{Command, Stdio};

/// Opens the system file manager with `path` selected.
pub fn reveal(path: &Path) -> Result<(), FsError> {
    reveal_impl(path)
}

/// `file://` URI with everything but unreserved characters and `/` percent-encoded
/// (also `,` – `dbus-send` splits arrays at commas).
pub fn file_uri(path: &Path) -> String {
    #[cfg(unix)]
    let bytes = {
        use std::os::unix::ffi::OsStrExt;
        path.as_os_str().as_bytes().to_vec()
    };
    #[cfg(not(unix))]
    let bytes = path.to_string_lossy().replace('\\', "/").into_bytes();
    let mut out = String::from("file://");
    for b in bytes {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~' | b'/') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

pub fn spawn_error(e: &io::Error, program: &str) -> FsError {
    if e.kind() == io::ErrorKind::NotFound {
        FsError::new(
            FsErrorCode::ProgramNotFound,
            format!("the program \"{program}\" was not found"),
            None,
        )
    } else {
        FsError::new(
            FsErrorCode::Io,
            format!("\"{program}\" could not be started: {e}"),
            None,
        )
    }
}

// ---- macOS ----

#[cfg(target_os = "macos")]
fn reveal_impl(path: &Path) -> Result<(), FsError> {
    let status = std::process::Command::new("/usr/bin/open")
        .arg("-R")
        .arg(path)
        .status()
        .map_err(|e| spawn_error(&e, "open"))?;
    if status.success() {
        Ok(())
    } else {
        Err(FsError::new(
            FsErrorCode::Io,
            format!("\"open -R\" failed ({status})"),
            Some(path),
        ))
    }
}

// ---- Windows ----

#[cfg(windows)]
fn reveal_impl(path: &Path) -> Result<(), FsError> {
    use std::os::windows::process::CommandExt;
    let p = path.to_string_lossy();
    if p.contains('"') {
        return Err(FsError::new(
            FsErrorCode::InvalidPath,
            "the path contains a quote",
            Some(path),
        ));
    }
    // absolute, so that Windows never picks a same-named file from the current folder
    let explorer = std::env::var_os("SystemRoot")
        .map(std::path::PathBuf::from)
        .filter(|p| p.is_absolute())
        .unwrap_or_else(|| std::path::PathBuf::from("C:\\Windows"))
        .join("explorer.exe");
    // Explorer only understands `/select,"<path>"` as one raw argument; its exit code is 1
    // even on success, so it is not checked.
    let mut cmd = Command::new(&explorer);
    cmd.raw_arg(format!("/select,\"{p}\""))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = cmd.spawn().map_err(|e| spawn_error(&e, "explorer.exe"))?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

// ---- Linux and other Unix ----

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_impl(path: &Path) -> Result<(), FsError> {
    // freedesktop FileManager1 (Nautilus, Dolphin, Nemo, Thunar …)
    let shown = Command::new("dbus-send")
        .args([
            "--session",
            "--print-reply",
            "--reply-timeout=3000",
            "--dest=org.freedesktop.FileManager1",
            "--type=method_call",
            "/org/freedesktop/FileManager1",
            "org.freedesktop.FileManager1.ShowItems",
        ])
        .arg(format!("array:string:{}", file_uri(path)))
        .arg("string:")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|s| s.success());
    if shown {
        return Ok(());
    }
    // no FileManager1 service: open the parent folder with the default app
    let folder = path.parent().unwrap_or(path);
    open::that_detached(folder).map_err(|e| spawn_error(&e, "xdg-open"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uris_are_percent_encoded() {
        assert_eq!(
            file_uri(Path::new("/a b/ä,c#?.txt")),
            "file:///a%20b/%C3%A4%2Cc%23%3F.txt"
        );
    }

    #[test]
    fn missing_programs_have_their_own_code() {
        let e = io::Error::from(io::ErrorKind::NotFound);
        assert_eq!(spawn_error(&e, "x").code, FsErrorCode::ProgramNotFound);
        let e = io::Error::from(io::ErrorKind::Other);
        assert_eq!(spawn_error(&e, "x").code, FsErrorCode::Io);
    }
}
