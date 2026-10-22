/**
 * Texts of the library view (English = source). Prompt 009 adds the German catalogue and the
 * runtime switch – until then, keep every UI text here, never inline in templates.
 */
export const LIBRARY_TEXTS = {
  folderLabel: 'Library folder',
  folderPlaceholder: '/path/to/comics or ~/Comics',
  scan: 'Scan',
  scanning: 'Scanning…',
  listLabel: 'Comic books',
  empty: 'No comic books (CBZ, CBR, CB7, CBT, PDF) in this folder.',
  books: (n: number) => (n === 1 ? '1 book' : `${n.toLocaleString()} books`),
  more: (n: number) => `… and ${n.toLocaleString()} more – the cover grid follows in prompt 004.`,
  truncated: 'The scan stopped at the limit; not all books are shown.',
  unreadable: (n: number) => (n === 1 ? '1 folder unreadable' : `${n} folders unreadable`),
};
