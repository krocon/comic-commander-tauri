import { Injectable } from '@angular/core';
import { Channel, convertFileSrc } from '@tauri-apps/api/core';
import { call } from '../backend/call';
import { OpenedBook, ReaderEvent, ReadingPosition } from './reader.models';

/** The scheme of the pages (Rust `reader::url::SCHEME`, design 005 E7). */
export const PAGE_SCHEME = 'ccpage';

/** `<token>.<page>.<width>` – a token of an open book, never a path. */
export function pagePath(token: string, index: number, width: number): string {
  return `${token}.${index}.${width}`;
}

/**
 * Typed facade of the reader commands (design 005); tests bind `FakeReaderApi`. Books are named
 * by category id + book id, pages by the token of `open`.
 */
export abstract class ReaderApi {
  abstract open(
    categoryId: string,
    bookId: string,
    onEvent: (event: ReaderEvent) => void,
  ): Promise<OpenedBook>;
  abstract close(token: string): Promise<void>;
  /** URL of a page; `width` = target width in device pixels (0 = original), `retry` > 0 asks again. */
  abstract pageUrl(token: string, index: number, width: number, retry?: number): string;
  abstract savePosition(
    categoryId: string,
    bookId: string,
    page: number,
    pages: number,
    rotation: number,
  ): Promise<void>;
  abstract loadReadingState(): Promise<Record<string, ReadingPosition>>;
  /** Returns the new state. */
  abstract toggleFullscreen(): Promise<boolean>;
}

@Injectable()
export class TauriReaderApi extends ReaderApi {
  open(
    categoryId: string,
    bookId: string,
    onEvent: (event: ReaderEvent) => void,
  ): Promise<OpenedBook> {
    const channel = new Channel<ReaderEvent>();
    channel.onmessage = onEvent;
    return call<OpenedBook>('open_book', { categoryId, bookId, onEvent: channel });
  }

  close(token: string): Promise<void> {
    return call<void>('close_book', { token });
  }

  pageUrl(token: string, index: number, width: number, retry = 0): string {
    const url = convertFileSrc(pagePath(token, index, width), PAGE_SCHEME);
    return retry > 0 ? `${url}?retry=${retry}` : url;
  }

  savePosition(
    categoryId: string,
    bookId: string,
    page: number,
    pages: number,
    rotation: number,
  ): Promise<void> {
    return call<void>('save_reading_position', { categoryId, bookId, page, pages, rotation });
  }

  loadReadingState(): Promise<Record<string, ReadingPosition>> {
    return call<Record<string, ReadingPosition>>('load_reading_state');
  }

  toggleFullscreen(): Promise<boolean> {
    return call<boolean>('toggle_fullscreen');
  }
}
