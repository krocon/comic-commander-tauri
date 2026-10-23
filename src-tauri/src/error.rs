use serde::{Deserialize, Serialize};
use std::io;
use std::path::Path;

/// Machine-readable error codes. Serialised as `snake_case` strings so the frontend can map
/// them to user-facing texts (`describeFsError()` in `src/app/core/errors/fs-error.ts`).
/// A new code goes into both files.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FsErrorCode {
    NotFound,
    PermissionDenied,
    NotADirectory,
    InvalidPath,
    NoHomeDirectory,
    /// Any other I/O error (message carries the details).
    Io,
    /// The categories sent to `save_categories` are not valid (design 002).
    InvalidCategories,
    /// The file chosen for the import is no config of the old comiccommander (design 002 E7).
    InvalidLegacyConfig,
    /// `open_category`/`cancel_scan` with an id that is not configured.
    UnknownCategory,
    /// A comic book (archive) is broken or uses something we cannot read (design 003).
    ArchiveError,
    /// An archive or image exceeds the safety limits (entries, size, pixels, dictionary).
    ArchiveTooLarge,
    /// The book (or its cover entry) is encrypted – covers are never asked for a password.
    ArchiveEncrypted,
    /// The container format is not supported (e.g. a PDF asked for as an archive, a page that is no image).
    UnsupportedFormat,
    /// The image cannot be decoded (broken, unknown format).
    UnsupportedImage,
    /// The book contains no image.
    NoImage,
    /// Reading took longer than allowed (design 003 E9).
    Timeout,
    /// Too much work waiting (cover pool full) – ask again later.
    Busy,
    /// A book id the scan of that category did not list (design 004 E5).
    UnknownBook,
    /// An OS program (file manager) is missing (design 004 E5).
    ProgramNotFound,
    /// A job of this kind is running already (design 007).
    JobRunning,
}

/// The one error type every command returns.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct FsError {
    pub code: FsErrorCode,
    pub message: String,
    pub path: Option<String>,
}

impl FsError {
    pub fn new(code: FsErrorCode, message: impl Into<String>, path: Option<&Path>) -> Self {
        Self {
            code,
            message: message.into(),
            path: path.map(|p| p.to_string_lossy().into_owned()),
        }
    }

    /// Maps an `io::Error` to a code; the path is the one the operation was about.
    pub fn from_io(err: &io::Error, path: &Path) -> Self {
        let code = match err.kind() {
            io::ErrorKind::NotFound => FsErrorCode::NotFound,
            io::ErrorKind::PermissionDenied => FsErrorCode::PermissionDenied,
            io::ErrorKind::NotADirectory => FsErrorCode::NotADirectory,
            _ => FsErrorCode::Io,
        };
        Self::new(code, err.to_string(), Some(path))
    }
}

impl std::fmt::Display for FsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for FsError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_serialise_as_snake_case() {
        let e = FsError::new(FsErrorCode::NotADirectory, "x", Some(Path::new("/a")));
        let json = serde_json::to_string(&e).unwrap();
        assert_eq!(
            json,
            r#"{"code":"not_a_directory","message":"x","path":"/a"}"#
        );
    }

    #[test]
    fn io_errors_map_to_codes() {
        let p = Path::new("/x");
        let nf = io::Error::from(io::ErrorKind::NotFound);
        assert_eq!(FsError::from_io(&nf, p).code, FsErrorCode::NotFound);
        let pd = io::Error::from(io::ErrorKind::PermissionDenied);
        assert_eq!(FsError::from_io(&pd, p).code, FsErrorCode::PermissionDenied);
        let other = io::Error::other("boom");
        assert_eq!(FsError::from_io(&other, p).code, FsErrorCode::Io);
    }
}
