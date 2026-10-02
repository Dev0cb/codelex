import { describe, expect, it } from 'vitest';

import { CLXI_MAGIC, SUPPORTED_FORMAT_VERSIONS, decodeLexiconIndex } from './decode.js';
import type { LexiconIndexError, LexiconVersion } from './types.js';

function errorOf(bytes: Uint8Array): LexiconIndexError {
  const result = decodeLexiconIndex(bytes);
  if (result.ok) throw new Error('expected a decode error');
  return result.error;
}

function header(formatVersion: number, extra = 0): Uint8Array {
  const bytes = new Uint8Array(6 + extra);
  bytes.set(CLXI_MAGIC);
  new DataView(bytes.buffer).setUint16(4, formatVersion, true);
  return bytes;
}

describe('decodeLexiconIndex (sprint L2: format prefix only, no format supported yet)', () => {
  it('CLXI_MAGIC is ASCII "CLXI"', () => {
    expect(String.fromCharCode(...CLXI_MAGIC)).toBe('CLXI');
    expect(Object.isFrozen(CLXI_MAGIC)).toBe(true);
  });

  it('no format version is supported until L4', () => {
    expect(SUPPORTED_FORMAT_VERSIONS).toEqual([]);
    expect(Object.isFrozen(SUPPORTED_FORMAT_VERSIONS)).toBe(true);
  });

  it.each([0, 1, 5])('a %i-byte input is TRUNCATED', (length) => {
    const error = errorOf(new Uint8Array(length));
    expect(error.code).toBe('TRUNCATED');
    expect(error.details).toEqual({ length, required: 6 });
  });

  it('a wrong magic is BAD_MAGIC', () => {
    expect(errorOf(new TextEncoder().encode('{"terms":[]}')).code).toBe('BAD_MAGIC');
    const almost = header(1);
    almost[3] = 0x4a; // 'CLXJ'
    expect(errorOf(almost).code).toBe('BAD_MAGIC');
  });

  it.each([1, 2, 0xffff])('a CLXI header with format %i is UNSUPPORTED_FORMAT', (version) => {
    const error = errorOf(header(version, 64));
    expect(error.code).toBe('UNSUPPORTED_FORMAT');
    expect(error.details).toEqual({ formatVersion: version, supported: '' });
  });

  it('reads the prefix through byteOffset (unaligned views of a larger buffer)', () => {
    const backing = new Uint8Array(16);
    backing.set(header(3), 1);
    const error = errorOf(backing.subarray(1));
    expect(error.code).toBe('UNSUPPORTED_FORMAT');
    expect(error.details?.['formatVersion']).toBe(3);
  });

  it('accepts an expectation without changing the outcome, and never throws', () => {
    const result = decodeLexiconIndex(header(1), {
      version: '2f2cc6fca8fac92b' as LexiconVersion,
      profileId: 'global-ranked',
    });
    expect(result.ok).toBe(false);
  });

  it('returns frozen errors with a message', () => {
    const error = errorOf(new Uint8Array(0));
    expect(Object.isFrozen(error)).toBe(true);
    expect(Object.isFrozen(error.details)).toBe(true);
    expect(error.message.length).toBeGreaterThan(0);
  });
});
