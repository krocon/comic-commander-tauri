//! TAR books (CBT). Read in *raw* mode: the crate would load a GNU long name or a PAX header of
//! any size into memory – here metadata entries above [`super::MAX_TAR_META`] are refused and
//! otherwise skipped (a file then keeps the 100-byte name of its own header; good enough to
//! choose a cover). Only regular files are listed.

use super::{
    Budget, Entry, MAX_ENTRIES, MAX_TAR_META, OnRead, Take, archive_error, fatal, read_limited,
    take_from, too_large, too_many,
};
use crate::error::FsError;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use tar::{Archive, EntryType};

fn broken(e: std::io::Error, path: &Path) -> FsError {
    archive_error(format!("broken TAR: {e}"), path)
}

type OnEntry<'a> =
    &'a mut dyn for<'b> FnMut(usize, &mut tar::Entry<'b, BufReader<File>>) -> Result<bool, FsError>;

/// Walks the entries; `on` gets (ordinal, entry) of every regular file and returns `false` to
/// stop.
fn walk(path: &Path, budget: &Budget<'_>, on: OnEntry<'_>) -> Result<(), FsError> {
    let file = File::open(path).map_err(|e| FsError::from_io(&e, path))?;
    let mut archive = Archive::new(BufReader::new(file));
    // with seek: skipping a large entry does not read it
    let mut entries = archive
        .entries_with_seek()
        .map_err(|e| broken(e, path))?
        .raw(true);
    let mut ordinal = 0usize;
    for (seen, entry) in entries.by_ref().enumerate() {
        budget.check(path)?;
        if seen > MAX_ENTRIES * 2 {
            return Err(too_many(path));
        }
        let mut entry = entry.map_err(|e| broken(e, path))?;
        let kind = entry.header().entry_type();
        if matches!(
            kind,
            EntryType::GNULongName
                | EntryType::GNULongLink
                | EntryType::XHeader
                | EntryType::XGlobalHeader
        ) {
            if entry.size() > MAX_TAR_META {
                return Err(too_large("TAR metadata header too large", path));
            }
            continue;
        }
        if !matches!(kind, EntryType::Regular | EntryType::Continuous) {
            continue;
        }
        if !on(ordinal, &mut entry)? {
            return Ok(());
        }
        ordinal += 1;
    }
    Ok(())
}

pub(super) fn list(path: &Path, budget: &Budget<'_>) -> Result<Vec<Entry>, FsError> {
    let mut out = Vec::new();
    walk(path, budget, &mut |pos, e| {
        out.push(Entry {
            name: String::from_utf8_lossy(&e.path_bytes()).into_owned(),
            size: e.size(),
            pos,
            encrypted: false,
        });
        Ok(true)
    })?;
    Ok(out)
}

pub(super) fn read(
    path: &Path,
    entry: &Entry,
    max_bytes: u64,
    budget: &Budget<'_>,
) -> Result<Vec<u8>, FsError> {
    let mut data = None;
    walk(path, budget, &mut |pos, e| {
        if pos != entry.pos {
            return Ok(true);
        }
        data = Some(read_limited(e, entry.size, max_bytes, budget, path)?);
        Ok(false)
    })?;
    data.ok_or_else(|| archive_error("entry not found", path))
}

/// One pass in book order.
pub(super) fn read_many(
    path: &Path,
    wanted: &[usize],
    take: Take,
    budget: &Budget<'_>,
    on: OnRead<'_>,
) -> Result<(), FsError> {
    let mut left: std::collections::HashSet<usize> = wanted.iter().copied().collect();
    walk(path, budget, &mut |pos, e| {
        if !left.remove(&pos) {
            return Ok(true);
        }
        let size = e.size();
        let outcome = take_from(e, size, take, budget, path);
        if let Err(err) = &outcome
            && fatal(err)
        {
            return Err(err.clone());
        }
        Ok(on(pos, outcome) && !left.is_empty())
    })
}
