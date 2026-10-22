//! Validation of paths that come from the frontend. Paths are opaque strings there; all
//! path logic lives here (`std::path`), never `canonicalize` for navigation.

use crate::error::{FsError, FsErrorCode};
use std::path::{Path, PathBuf};

/// Longest path string accepted from the frontend.
pub const MAX_PATH_LEN: usize = 4096;

/// The user's home folder.
pub fn home_dir() -> Result<PathBuf, FsError> {
    std::env::home_dir()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| FsError::new(FsErrorCode::NoHomeDirectory, "no home directory", None))
}

/// Checks a path typed or stored by the user: not empty, no NUL, not too long, absolute
/// after expanding a leading `~` (alone or followed by a separator).
pub fn validate_input_path(raw: &str) -> Result<PathBuf, FsError> {
    let trimmed = raw.trim();
    let invalid = |msg: &str| FsError::new(FsErrorCode::InvalidPath, msg, None);
    if trimmed.is_empty() {
        return Err(invalid("empty path"));
    }
    if trimmed.len() > MAX_PATH_LEN {
        return Err(invalid("path too long"));
    }
    if trimmed.contains('\0') {
        return Err(invalid("path contains NUL"));
    }
    let path = expand_tilde(trimmed)?;
    if !path.is_absolute() {
        return Err(FsError::new(
            FsErrorCode::InvalidPath,
            "path is not absolute",
            Some(&path),
        ));
    }
    Ok(path)
}

fn expand_tilde(s: &str) -> Result<PathBuf, FsError> {
    if s == "~" {
        return home_dir();
    }
    let rest = s.strip_prefix("~/").or_else(|| {
        if cfg!(windows) {
            s.strip_prefix("~\\")
        } else {
            None
        }
    });
    match rest {
        Some(rest) => Ok(home_dir()?.join(rest)),
        None => Ok(PathBuf::from(s)),
    }
}

/// Segments of `path` below `root`, joined with `/` (display only). `None` if `path` is not
/// below `root` or a segment is not valid UTF-8.
pub fn rel_display(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let mut out = String::new();
    for (i, c) in rel.components().enumerate() {
        if i > 0 {
            out.push('/');
        }
        out.push_str(c.as_os_str().to_str()?);
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_relative_and_nul() {
        for raw in ["", "   ", "relative/dir", "a\0b"] {
            let e = validate_input_path(raw).unwrap_err();
            assert_eq!(e.code, FsErrorCode::InvalidPath, "{raw:?}");
        }
    }

    #[test]
    fn rejects_overlong_paths() {
        let raw = format!("/{}", "a".repeat(MAX_PATH_LEN));
        assert_eq!(
            validate_input_path(&raw).unwrap_err().code,
            FsErrorCode::InvalidPath
        );
    }

    #[test]
    fn expands_tilde() {
        let home = home_dir().unwrap();
        assert_eq!(validate_input_path("~").unwrap(), home);
        assert_eq!(
            validate_input_path("~/Comics").unwrap(),
            home.join("Comics")
        );
        // `~user` is not expanded – and therefore relative
        assert!(validate_input_path("~other").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn accepts_absolute_paths_with_spaces_and_umlauts() {
        let p = validate_input_path("  /tmp/Comics Ä ö 🦸  ").unwrap();
        assert_eq!(p, PathBuf::from("/tmp/Comics Ä ö 🦸"));
    }

    #[test]
    fn rel_display_joins_with_slash() {
        let root = Path::new("/lib");
        let p = root.join("Serie").join("Band 01.cbz");
        assert_eq!(rel_display(root, &p).as_deref(), Some("Serie/Band 01.cbz"));
        assert_eq!(rel_display(root, Path::new("/other/x.cbz")), None);
    }
}
