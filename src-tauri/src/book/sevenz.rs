//! 7z books (CB7) through `sevenz-rust2`, opened only after the fail-closed header check taken
//! over from files-and-folders (`sevenz_header.rs`, design 003 E7). Before a block is decoded,
//! its coders are checked: encrypted → `archive_encrypted`, dictionary above
//! [`super::MAX_DICT`] → `archive_too_large`. In a solid block the entries before the wanted
//! one are decoded and dropped (they must be read, else the next one gets their bytes).
//!
//! `memory_need` and the error mapping follow files-and-folders `archive/sevenz.rs`.

use super::{Budget, Entry, MAX_DICT, archive_error, drain, encrypted, read_limited, too_large};
use crate::error::FsError;
use sevenz_rust2::{Archive, Block, BlockDecoder, EncoderMethod, Password};
use std::fs::File;
use std::io::{BufReader, Seek, SeekFrom};
use std::path::Path;

/// `FILE_ATTRIBUTE_UNIX_EXTENSION`: the high 16 bits hold the Unix mode.
const UNIX_EXTENSION: u32 = 0x8000;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
const S_IFMT: u32 = 0o170000;
const S_IFREG: u32 = 0o100000;

fn map_error(e: sevenz_rust2::Error, path: &Path) -> FsError {
    use sevenz_rust2::Error as E;
    match e {
        E::PasswordRequired | E::MaybeBadPassword(_) => encrypted(path),
        E::Io(io, _) | E::FileOpen(io, _) => match io.kind() {
            std::io::ErrorKind::NotFound | std::io::ErrorKind::PermissionDenied => {
                FsError::from_io(&io, path)
            }
            _ => archive_error(format!("broken 7z: {io}"), path),
        },
        E::MaxMemLimited { .. } => too_large("the 7z needs too much memory", path),
        E::UnsupportedCompressionMethod(m) => {
            archive_error(format!("compression method {m} is not supported"), path)
        }
        other => archive_error(format!("broken 7z: {other:?}"), path),
    }
}

fn open(path: &Path) -> Result<(BufReader<File>, Archive), FsError> {
    let mut file = File::open(path).map_err(|e| FsError::from_io(&e, path))?;
    // the crate unpacks the header without limits: check it first, on the same open file
    let checked = super::sevenz_header::check(&mut file, path)?;
    if checked.empty {
        return Ok((BufReader::new(file), Archive::default()));
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|e| FsError::from_io(&e, path))?;
    let mut reader = BufReader::new(file);
    let archive = Archive::read(&mut reader, &Password::empty()).map_err(|e| map_error(e, path))?;
    Ok((reader, archive))
}

fn block_encrypted(block: &Block) -> bool {
    block
        .coders
        .iter()
        .any(|c| c.encoder_method_id() == EncoderMethod::ID_AES256_SHA256)
}

fn le_u32(p: &[u8]) -> Option<u64> {
    p.get(..4)
        .map(|b| u64::from(u32::from_le_bytes([b[0], b[1], b[2], b[3]])))
}

/// Dictionary / model memory a coder asks for (LZMA, LZMA2, PPMd), from its properties.
pub(crate) fn memory_need(method: &[u8], props: &[u8]) -> Option<u64> {
    match method {
        id if id == EncoderMethod::ID_LZMA || id == EncoderMethod::ID_PPMD => {
            props.get(1..).and_then(le_u32)
        }
        id if id == EncoderMethod::ID_LZMA2 => props.first().map(|b| {
            let bits = u32::from(*b & 0x3F);
            if bits > 40 {
                u64::MAX
            } else if bits == 40 {
                u64::from(u32::MAX)
            } else {
                u64::from(2 | (bits & 1)) << (bits / 2 + 11)
            }
        }),
        _ => None,
    }
}

fn check_block(block: &Block, path: &Path) -> Result<(), FsError> {
    if block_encrypted(block) {
        return Err(encrypted(path));
    }
    for c in &block.coders {
        if memory_need(c.encoder_method_id(), c.properties()).is_some_and(|n| n > MAX_DICT) {
            return Err(too_large(
                "the 7z needs a dictionary larger than 1 GiB",
                path,
            ));
        }
    }
    Ok(())
}

fn is_regular(e: &sevenz_rust2::ArchiveEntry) -> bool {
    if e.is_directory || e.is_anti_item || !e.has_stream {
        return false;
    }
    let attr = if e.has_windows_attributes {
        e.windows_attributes
    } else {
        0
    };
    if attr & UNIX_EXTENSION != 0 {
        let fmt = (attr >> 16) & S_IFMT;
        fmt == 0 || fmt == S_IFREG
    } else {
        attr & FILE_ATTRIBUTE_REPARSE_POINT == 0
    }
}

pub(super) fn list(path: &Path, budget: &Budget<'_>) -> Result<Vec<Entry>, FsError> {
    let (_, archive) = open(path)?;
    budget.check(path)?;
    Ok(archive
        .files
        .iter()
        .enumerate()
        .filter(|(_, e)| is_regular(e))
        .map(|(pos, e)| Entry {
            name: e.name.clone(),
            size: e.size,
            pos,
            encrypted: archive
                .stream_map
                .file_block_index
                .get(pos)
                .copied()
                .flatten()
                .and_then(|b| archive.blocks.get(b))
                .is_some_and(block_encrypted),
        })
        .collect())
}

pub(super) fn read(
    path: &Path,
    entry: &Entry,
    max_bytes: u64,
    budget: &Budget<'_>,
) -> Result<Vec<u8>, FsError> {
    let (mut reader, archive) = open(path)?;
    let Some(target) = archive.files.get(entry.pos) else {
        return Err(archive_error("entry not found", path));
    };
    let Some(block_index) = archive
        .stream_map
        .file_block_index
        .get(entry.pos)
        .copied()
        .flatten()
    else {
        return Err(archive_error("entry has no data", path));
    };
    let block = archive
        .blocks
        .get(block_index)
        .ok_or_else(|| archive_error("broken 7z: block missing", path))?;
    check_block(block, path)?;
    let password = Password::empty();
    let mut data: Option<Vec<u8>> = None;
    let mut failure: Option<FsError> = None;
    let decoder = BlockDecoder::new(1, block_index, &archive, &password, &mut reader);
    let result = decoder.for_each_entries(&mut |e, r| {
        let outcome = if std::ptr::eq(e, target) {
            read_limited(r, entry.size, max_bytes, budget, path).map(|d| {
                data = Some(d);
                false
            })
        } else {
            drain(r, budget, path).map(|()| true)
        };
        match outcome {
            Ok(go_on) => Ok(go_on),
            Err(err) => {
                failure = Some(err);
                Ok(false)
            }
        }
    });
    if let Some(err) = failure {
        return Err(err);
    }
    result.map_err(|e| map_error(e, path))?;
    data.ok_or_else(|| archive_error("entry not found", path))
}
