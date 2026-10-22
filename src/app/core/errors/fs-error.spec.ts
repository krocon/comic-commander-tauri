import { describeFsError, toFsError } from './fs-error';

describe('toFsError', () => {
  it('keeps a known FsError', () => {
    const e = { code: 'not_found', message: 'x', path: '/a' };
    expect(toFsError(e)).toEqual(e);
  });

  it('maps an unknown code to unknown', () => {
    expect(toFsError({ code: 'weird', message: 'x' }).code).toBe('unknown');
  });

  it('wraps thrown errors and strings', () => {
    expect(toFsError(new Error('boom'))).toEqual({ code: 'unknown', message: 'boom' });
    expect(toFsError('plain')).toEqual({ code: 'unknown', message: 'plain' });
  });
});

describe('describeFsError', () => {
  it('never shows the backend message', () => {
    const text = describeFsError({ code: 'io', message: 'secret /Users/x detail' });
    expect(text).not.toContain('secret');
  });
});
