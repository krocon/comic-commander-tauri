/**
 * Vitest setup (jsdom): what the GuiExpert Table needs and jsdom lacks (files-and-folders G11).
 * Only for tests – never imported by app code.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe = (): void => undefined;
    unobserve = (): void => undefined;
    disconnect = (): void => undefined;
  } as unknown as typeof ResizeObserver;
}
