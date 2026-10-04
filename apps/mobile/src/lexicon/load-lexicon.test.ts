import { describe, expect, it, jest } from '@jest/globals';
import type { DecodeLexiconIndex } from '@codelex/lexicon/index';

import bundledDescriptor from '../../assets/lexicon/lexicon.json';
import { createBundledLexiconSource } from './bundled-lexicon-source';
import {
  loadLexicon,
  parseLexiconAssetDescriptor,
  toHex,
  type LexiconLoadErrorCode,
  type LexiconLoadResult,
  type LexiconSource,
} from './load-lexicon';

// Native modules run on Node stand-ins that read the real asset written by `prepare:lexicon`.
jest.mock('expo-asset', () => jest.requireActual('../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../jest/expo-file-system.cjs'));

const bundled = createBundledLexiconSource();

/** The bundled source with some parts replaced (descriptor fields, bytes, digest). */
function variant(
  overrides: {
    readonly descriptor?: Readonly<Record<string, unknown>>;
    readonly bytes?: (real: Uint8Array) => Uint8Array;
    readonly sha256Hex?: LexiconSource['sha256Hex'];
  } = {},
): LexiconSource {
  return {
    descriptor: { ...bundledDescriptor, ...overrides.descriptor },
    readBytes: async () => {
      const real = await bundled.readBytes();
      return overrides.bytes ? overrides.bytes(real) : real;
    },
    sha256Hex: overrides.sha256Hex ?? ((bytes) => bundled.sha256Hex(bytes)),
  };
}

function codeOf(result: LexiconLoadResult): LexiconLoadErrorCode | 'ok' {
  return result.ok ? 'ok' : result.error.code;
}

/** Flips one byte in the middle of the artefact (inside a section, after the header). */
const flipped = (real: Uint8Array): Uint8Array => {
  const copy = new Uint8Array(real);
  const at = Math.floor(copy.length / 2);
  copy[at] = (copy[at] ?? 0) ^ 0xff;
  return copy;
};

describe('loadLexicon', () => {
  it('loads and verifies the bundled asset (f1, with the GADDAG)', async () => {
    const result = await loadLexicon(bundled);
    if (!result.ok) throw new Error(result.error.message);
    const { index, descriptor } = result.value;
    expect(descriptor).toEqual(bundledDescriptor);
    expect(index.version).toBe(bundledDescriptor.lexiconVersion);
    expect(index.profile.id).toBe(bundledDescriptor.profileId);
    expect(descriptor.flags).toBe(1);
    expect(index.gaddag).toBeDefined();
    expect(index.size).toBeGreaterThan(1000);
    expect(index.has('API')).toBe(true);
    expect(index.has('QZXQ')).toBe(false);
  });

  it('refuses bytes whose sha256 differs from the descriptor (LEXICON_INDEX_CORRUPT)', async () => {
    const decode = jest.fn<DecodeLexiconIndex>();
    const result = await loadLexicon(variant({ descriptor: { sha256: '0'.repeat(64) } }), decode);
    expect(codeOf(result)).toBe('LEXICON_INDEX_CORRUPT');
    expect(decode).not.toHaveBeenCalled();
  });

  it('refuses tampered bytes even when their size matches (LEXICON_INDEX_CORRUPT)', async () => {
    expect(codeOf(await loadLexicon(variant({ bytes: flipped })))).toBe('LEXICON_INDEX_CORRUPT');
  });

  it('refuses a truncated asset before hashing it (LEXICON_INDEX_CORRUPT)', async () => {
    const sha256Hex = jest.fn<LexiconSource['sha256Hex']>();
    const result = await loadLexicon(
      variant({ bytes: (real) => real.subarray(0, real.length - 1), sha256Hex }),
    );
    expect(codeOf(result)).toBe('LEXICON_INDEX_CORRUPT');
    expect(sha256Hex).not.toHaveBeenCalled();
  });

  it('accepts an uppercase hex digest from the platform', async () => {
    const upper: LexiconSource['sha256Hex'] = async (bytes) =>
      (await bundled.sha256Hex(bytes)).toUpperCase();
    expect(codeOf(await loadLexicon(variant({ sha256Hex: upper })))).toBe('ok');
  });

  it('reports a failing digest as LEXICON_INDEX_CORRUPT', async () => {
    const result = await loadLexicon(
      variant({ sha256Hex: () => Promise.reject(new Error('no digest')) }),
    );
    expect(result).toEqual({
      ok: false,
      error: { code: 'LEXICON_INDEX_CORRUPT', message: 'cannot hash the lexicon asset: no digest' },
    });
  });

  it('returns the decoder error when verified bytes do not decode', async () => {
    // Bytes and descriptor agree (same tampered bytes hashed), so only the decoder's CRC check can catch it.
    const tampered = flipped(await bundled.readBytes());
    const source: LexiconSource = {
      descriptor: { ...bundledDescriptor, sha256: await bundled.sha256Hex(tampered) },
      readBytes: () => Promise.resolve(tampered),
      sha256Hex: (bytes) => bundled.sha256Hex(bytes),
    };
    const result = await loadLexicon(source);
    expect(codeOf(result)).toBe('CORRUPT');
  });

  it('returns VERSION_MISMATCH when the artefact is another lexiconVersion', async () => {
    const result = await loadLexicon(
      variant({ descriptor: { lexiconVersion: 'ffffffffffffffff' } }),
    );
    expect(codeOf(result)).toBe('VERSION_MISMATCH');
  });

  it('returns PROFILE_MISMATCH when the artefact is another profile', async () => {
    const result = await loadLexicon(variant({ descriptor: { profileId: 'season-s01' } }));
    expect(codeOf(result)).toBe('PROFILE_MISMATCH');
  });

  it('refuses an artefact whose GADDAG presence differs from the flags', async () => {
    const result = await loadLexicon(variant({ descriptor: { flags: 0 } }));
    expect(codeOf(result)).toBe('LEXICON_INDEX_CORRUPT');
  });

  it('reports an unreadable asset as LEXICON_INDEX_MISSING', async () => {
    const source: LexiconSource = {
      ...bundled,
      readBytes: () => Promise.reject(new Error('ENOENT')),
    };
    expect(codeOf(await loadLexicon(source))).toBe('LEXICON_INDEX_MISSING');
    const unresolvable = createBundledLexiconSource(42);
    const result = await loadLexicon(unresolvable);
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'LEXICON_INDEX_MISSING',
        message: 'cannot read the lexicon asset: lexicon asset has no local file',
      },
    });
    const thrown: LexiconSource = {
      ...bundled,
      // A platform module may reject with a non-Error value.
      readBytes: jest.fn<LexiconSource['readBytes']>().mockRejectedValue('native failure'),
    };
    expect(codeOf(await loadLexicon(thrown))).toBe('LEXICON_INDEX_MISSING');
  });

  it.each([
    ['no descriptor', null],
    ['an array', []],
    ['a bad version', { lexiconVersion: 'v1' }],
    ['a bad profile id', { profileId: 'Global Ranked' }],
    ['non-integer flags', { flags: 1.5 }],
    ['negative flags', { flags: -1 }],
    ['flags over 16 bits', { flags: 0x10000 }],
    ['a bad sha256', { sha256: 'abc' }],
    ['zero bytes', { bytes: 0 }],
    ['string bytes', { bytes: '283672' }],
  ])('reports a descriptor with %s as LEXICON_INDEX_MISSING', async (_label, descriptor) => {
    const source: LexiconSource = {
      ...bundled,
      descriptor:
        descriptor === null || Array.isArray(descriptor)
          ? descriptor
          : { ...bundledDescriptor, ...descriptor },
    };
    expect(codeOf(await loadLexicon(source))).toBe('LEXICON_INDEX_MISSING');
  });
});

describe('parseLexiconAssetDescriptor', () => {
  it('accepts the generated descriptor and drops unknown fields', () => {
    expect(parseLexiconAssetDescriptor({ ...bundledDescriptor, extra: true })).toEqual(
      bundledDescriptor,
    );
  });
});

describe('toHex', () => {
  it('encodes bytes as lowercase, zero-padded hex', () => {
    expect(toHex(new Uint8Array([0, 1, 0xab, 0xff]))).toBe('0001abff');
    expect(toHex(new Uint8Array())).toBe('');
  });
});
