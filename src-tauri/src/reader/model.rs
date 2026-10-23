//! DTOs of the reader (design 005) – keep in sync with `src/app/core/reader/reader.models.ts`.

use crate::error::FsError;
use serde::Serialize;

/// One page of a book, in reading order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageInfo {
    /// Name inside the book – display only.
    pub name: String,
    /// Declared size in bytes.
    pub size: u64,
    /// Known in advance only for unpacked books (E9); else they come as `dims` events.
    pub width: Option<u32>,
    pub height: Option<u32>,
}

/// Answer of `open_book`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedBook {
    /// Names the open book in page URLs until `close_book` (E7).
    pub token: String,
    pub pages: Vec<PageInfo>,
    /// The remembered page (0-based) or `None` for a new book (E5).
    pub last_page: Option<usize>,
    /// The remembered rotation of the book (0/90/180/270, design 014 E5) – set by the caller.
    pub rotation: u16,
    /// The book is unpacked into the app cache (7z, solid RAR – E1).
    pub extracting: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageDims {
    pub index: usize,
    pub width: u32,
    pub height: u32,
}

/// Events of an open book (Channel of `open_book`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReaderEvent {
    /// Sizes of pages, as soon as they are known (E9).
    Dims { pages: Vec<PageDims> },
    /// The background pass is over.
    Done,
    /// The background pass broke off (pages not yet unpacked fail with this error).
    Failed { error: FsError },
}
