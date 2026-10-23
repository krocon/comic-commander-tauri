//! ZIP books (CBZ, and CBR that are really ZIP). The central directory is read once; before
//! the `zip` crate parses it, [`check_directory`] reads its declared size from the end of the
//! file and refuses more than [`super::MAX_ENTRIES`] entries or [`MAX_DIRECTORY`] bytes – the
//! crate would build every record first (review 003 #1). Entries are read with a byte limit.

use super::{
    Budget, Entry, MAX_ENTRIES, OnRead, Take, archive_error, encrypted, fatal, read_limited,
    take_from, too_large, too_many,
};
use crate::error::FsError;
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
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

/// Largest central directory accepted (200 000 entries with long names fit easily).
pub const MAX_DIRECTORY: u64 = 64 << 20;
/// End of central directory record (22 bytes) + longest comment.
const EOCD_SEARCH: u64 = 22 + 0xFFFF;

fn u16_at(b: &[u8], i: usize) -> u64 {
    u64::from(u16::from_le_bytes([b[i], b[i + 1]]))
}

fn u32_at(b: &[u8], i: usize) -> u64 {
    u64::from(u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]))
}

fn u64_at(b: &[u8], i: usize) -> u64 {
    let mut a = [0u8; 8];
    a.copy_from_slice(&b[i..i + 8]);
    u64::from_le_bytes(a)
}

/// Declared entries and directory size, from the (ZIP64) end of central directory. Without a
/// readable record: `None` – the `zip` crate reports the broken file.
fn declared(file: &mut File) -> std::io::Result<Option<(u64, u64)>> {
    let len = file.metadata()?.len();
    let start = len.saturating_sub(EOCD_SEARCH);
    file.seek(SeekFrom::Start(start))?;
    let mut tail = Vec::with_capacity((len - start) as usize);
    file.by_ref().take(EOCD_SEARCH).read_to_end(&mut tail)?;
    let Some(at) = tail
        .windows(4)
        .rposition(|w| w == b"PK\x05\x06")
        .filter(|at| at + 22 <= tail.len())
    else {
        return Ok(None);
    };
    let (entries, size) = (u16_at(&tail, at + 10), u32_at(&tail, at + 12));
    if entries != 0xFFFF && size != 0xFFFF_FFFF {
        return Ok(Some((entries, size)));
    }
    // ZIP64: the locator sits right before the record and points to the ZIP64 record
    let Some(loc) = at
        .checked_sub(20)
        .filter(|l| &tail[*l..*l + 4] == b"PK\x06\x07")
    else {
        return Ok(Some((entries, size)));
    };
    let eocd64 = u64_at(&tail, loc + 8);
    if eocd64.saturating_add(56) > len {
        return Ok(None);
    }
    let mut rec = [0u8; 56];
    file.seek(SeekFrom::Start(eocd64))?;
    file.read_exact(&mut rec)?;
    if &rec[..4] != b"PK\x06\x06" {
        return Ok(None);
    }
    Ok(Some((u64_at(&rec, 32), u64_at(&rec, 40))))
}

/// Refuses a central directory that is too large before anything is parsed.
pub fn check_directory(path: &Path) -> Result<(), FsError> {
    let mut file = File::open(path).map_err(|e| FsError::from_io(&e, path))?;
    match declared(&mut file).map_err(|e| FsError::from_io(&e, path))? {
        Some((entries, _)) if entries > MAX_ENTRIES as u64 => Err(too_many(path)),
        Some((_, size)) if size > MAX_DIRECTORY => Err(too_large(
            format!("central directory larger than {} MiB", MAX_DIRECTORY >> 20),
            path,
        )),
        _ => Ok(()),
    }
}

fn open(path: &Path) -> Result<ZipArchive<BufReader<File>>, FsError> {
    check_directory(path)?;
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

/// One pass over `wanted` (in that order; the directory is read once).
pub(super) fn read_many(
    path: &Path,
    wanted: &[usize],
    take: Take,
    budget: &Budget<'_>,
    on: OnRead<'_>,
) -> Result<(), FsError> {
    let mut z = open(path)?;
    for &pos in wanted {
        budget.check(path)?;
        let outcome = match z.by_index(pos) {
            Ok(mut f) => {
                let size = f.size();
                take_from(&mut f, size, take, budget, path)
            }
            Err(e) => Err(map_error(e, path)),
        };
        if let Err(e) = &outcome
            && fatal(e)
        {
            return Err(e.clone());
        }
        if !on(pos, outcome) {
            break;
        }
    }
    Ok(())
}
