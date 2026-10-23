import { TestBed } from '@angular/core/testing';
import { KeyboardDispatcher } from '../app/core/actions/keyboard-dispatcher';
import { DialogService } from '../app/shared/dialog/dialog.service';
import { ReaderService } from '../app/features/reader/reader.service';

/**
 * Wires the keyboard dispatcher like the root component does (design 008) for a component
 * test: dialog → nothing, reader → reader + global, focus in the grid → grid + global.
 * Returns the cleanup (the listener must not outlive the test).
 */
export function wireKeyboard(): () => void {
  const dispatcher = TestBed.inject(KeyboardDispatcher);
  const dialogs = TestBed.inject(DialogService);
  const reader = TestBed.inject(ReaderService);
  dispatcher.setContextProvider((target) => {
    if (dialogs.open() !== null) return null;
    if (reader.session() !== null) return ['reader', 'global'];
    return target?.closest('app-cover-grid') ? ['grid', 'global'] : ['global'];
  });
  const listener = (e: KeyboardEvent) => dispatcher.handle(e);
  document.addEventListener('keydown', listener);
  return () => document.removeEventListener('keydown', listener);
}
