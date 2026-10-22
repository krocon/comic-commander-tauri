//! ZIP books (CBZ, and CBR that are really ZIP). The central directory is read once; a hostile
//! one is bounded by [`super::MAX_ENTRIES`]; entries are read with a byte limit.

use super::{Budget, Entry, MAX_ENTRIES, archive_error, encrypted, read_limited, too_many};
use crate::error::FsError;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use zip::ZipArchive;
use zip::result::ZipError;

fn map_error(e: ZipError, path: &Path) -> FsError {
    match e {
        ZipError::Io(io) => FsError::from_io(&io, path),
        ZipError::UnsupportedArchive(m) if m == ZipError::PASSWORD_REQUIRED => encrypted(path),
        ZipError::InvalidPassword => encrypted(path),
        ZipError::CompressionMethodNotSupported(m) => {
            archive_error(format!("compression method {m} is not supported"), path)
        }
        other => archive_error(format!("broken ZIP: {other}"), path),
    }
}

fn open(path: &Path) -> Result<ZipArchive<BufReader<File>>, FsError> {
    let file = File::open(path).map_err(|e| FsError::from_io(&e, path))?;
    let z = ZipArchive::new(BufReader::new(file)).map_err(|e| map_error(e, path))?;
    if z.len() > MAX_ENTRIES {
        return Err(too_many(path));
    }
    Ok(z)
}

pub(super) fn list(path: &Path, budget: &Budget<'_>) -> Result<Vec<Entry>, FsError> {
    let mut z = open(path)?;
    let mut out = Vec::new();
    for i in 0..z.len() {
        if i % 1024 == 0 {
            budget.check(path)?;
        }
        let f = z.by_index_raw(i).map_err(|e| map_error(e, path))?;
        if !f.is_file() || f.is_symlink() {
            continue;
        }
        out.push(Entry {
            name: f.name().map_err(|e| map_error(e, path))?.into_owned(),
            size: f.size(),
            pos: i,
            encrypted: f.encrypted(),
        });
    }
    Ok(out)
}

pub(super) fn read(
    path: &Path,
    entry: &Entry,
    max_bytes: u64,
    budget: &Budget<'_>,
) -> Result<Vec<u8>, FsError> {
    let mut z = open(path)?;
    let mut f = z.by_index(entry.pos).map_err(|e| map_error(e, path))?;
    read_limited(&mut f, entry.size, max_bytes, budget, path)
}
