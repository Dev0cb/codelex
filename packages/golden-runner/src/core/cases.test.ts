import { createHash } from 'node:crypto';

import { canonicalJson } from '@codelex/game-engine/canonical';
import { describe, expect, it } from 'vitest';

import {
  CaseError,
  errorCodeOf,
  lazy,
  OBSERVED_LIMIT,
  reportedObserved,
  runCase,
  unwrap,
} from './cases.js';

describe('case plumbing (ADR-0016 §D3.1)', () => {
  it('passes iff observed and expected have the same canonical bytes (key order is irrelevant)', () => {
    expect(
      runCase({ id: 'a', run: () => ({ observed: { b: 1, a: 2 }, expected: { a: 2, b: 1 } }) }),
    ).toEqual({
      id: 'a',
      status: 'pass',
      observed: { b: 1, a: 2 },
    });
    expect(runCase({ id: 'b', run: () => ({ observed: 1, expected: 2 }) })).toEqual({
      id: 'b',
      status: 'fail',
      observed: 1,
    });
  });

  it('reports observed above 1 KB as its SHA-256', () => {
    const big = 'x'.repeat(OBSERVED_LIMIT);
    const text = canonicalJson(big);
    expect(reportedObserved(big)).toEqual({
      sha256: createHash('sha256').update(text).digest('hex'),
    });
    expect(reportedObserved('x'.repeat(OBSERVED_LIMIT - 2))).toBe('x'.repeat(OBSERVED_LIMIT - 2));
  });

  it('turns throws and typed errors into error cases with a typed name, never a message', () => {
    expect(runCase({ id: 'c', run: () => ({ errorCode: 'ACTION_REJECTED' }) })).toEqual({
      id: 'c',
      status: 'error',
      errorCode: 'ACTION_REJECTED',
    });
    const thrown = runCase({
      id: 'd',
      run: () => {
        throw new RangeError('secret details');
      },
    });
    expect(thrown).toEqual({ id: 'd', status: 'error', errorCode: 'RangeError' });
    // A value outside the JCS subset cannot be reported: error, not a crash.
    expect(runCase({ id: 'e', run: () => ({ observed: true, expected: true }) })).toEqual({
      id: 'e',
      status: 'error',
      errorCode: 'TypeError',
    });
  });

  it('errorCodeOf falls back to Error for anything that is not a typed name', () => {
    expect(errorCodeOf(new CaseError('HASH_MISMATCH'))).toBe('HASH_MISMATCH');
    expect(errorCodeOf(new CaseError('not a name'))).toBe('Error');
    expect(errorCodeOf(new CaseError('X'.repeat(65)))).toBe('Error');
    expect(errorCodeOf('string')).toBe('Error');
  });

  it('unwrap returns the value or throws a CaseError named after the code', () => {
    expect(unwrap({ ok: true, value: 3 })).toBe(3);
    expect(() => unwrap({ ok: false, error: { code: 'LEXICON_MISMATCH' } })).toThrow(CaseError);
  });

  it('lazy computes once', () => {
    let calls = 0;
    const value = lazy(() => (calls += 1));
    expect([value(), value()]).toEqual([1, 1]);
  });
});
