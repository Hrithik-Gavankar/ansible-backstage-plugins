/*
 * Copyright Red Hat
 */

import { errorMessageFromUnknown, toError } from './toError';

describe('errorMessageFromUnknown', () => {
  it('uses Error.message', () => {
    expect(errorMessageFromUnknown(new Error('boom'))).toBe('boom');
  });

  it('returns string rejections as-is', () => {
    expect(errorMessageFromUnknown('plain string')).toBe('plain string');
  });

  it('reads message from plain objects', () => {
    expect(errorMessageFromUnknown({ message: 'from object' })).toBe(
      'from object',
    );
  });

  it('JSON-serializes other objects', () => {
    expect(errorMessageFromUnknown({ code: 'E_FAIL' })).toBe(
      '{"code":"E_FAIL"}',
    );
  });
});

describe('toError', () => {
  it('returns the same Error instance', () => {
    const err = new Error('keep');
    expect(toError(err)).toBe(err);
  });

  it('wraps unknown values with a message', () => {
    expect(toError({ message: 'wrapped' }).message).toBe('wrapped');
  });
});
