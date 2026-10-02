import { err, type Result } from '@codelex/config/result';

import type {
  LexiconIndex,
  LexiconIndexError,
  LexiconIndexErrorCode,
  LexiconIndexExpectation,
} from './types.js';

/**
 * Pure decoder of a `.clxi` artefact (lexicon-index note §2.2, §3.3). Never throws on bad input; returns a
 * typed error. Zero-copy typed-array views over `bytes` when 4-byte aligned, else one copy. `expect` turns a
 * different `lexiconVersion` / profile id into `VERSION_MISMATCH` / `PROFILE_MISMATCH`.
 */
export type DecodeLexiconIndex = (
  bytes: Uint8Array,
  expect?: LexiconIndexExpectation,
) => Result<LexiconIndex, LexiconIndexError>;

/** `CLXI` in ASCII: the first four bytes of every artefact. */
export const CLXI_MAGIC: readonly number[] = Object.freeze([0x43, 0x4c, 0x58, 0x49]);

/**
 * `.clxi` format versions this decoder can read. Empty until sprint L4 ships format 1: every well-formed
 * header is answered with `UNSUPPORTED_FORMAT`, never with a partial index.
 */
export const SUPPORTED_FORMAT_VERSIONS: readonly number[] = Object.freeze([]);

/** Magic (4 bytes) + `formatVersion` (u16 little-endian): enough to identify the format. */
const FORMAT_PREFIX_LENGTH = 6;

function indexError(
  code: LexiconIndexErrorCode,
  message: string,
  details: Readonly<Record<string, string | number>>,
): LexiconIndexError {
  return Object.freeze({ code, message, details: Object.freeze({ ...details }) });
}

/**
 * Sprint L2 scope: the signature is the contract; only the format prefix is read (magic, `formatVersion`).
 * The section decoder (DAWG, TERMS, ADJ, LETTERS, GADDAG, CRC32) and the `expect` checks arrive with format 1
 * in sprint L4. Until then engine tests use the reference index (sprint L3).
 *
 * TODO(L4): before adding 1 to SUPPORTED_FORMAT_VERSIONS, implement and test the `expect` checks: a header
 * `lexiconVersion` different from `expect.version` must return `VERSION_MISMATCH`, a profile id different from
 * `expect.profileId` must return `PROFILE_MISMATCH` (lexicon-index note §7 T-VERSION). Supporting format 1
 * without them would make `expect` silently ignored.
 */
export const decodeLexiconIndex: DecodeLexiconIndex = (bytes) => {
  if (bytes.length < FORMAT_PREFIX_LENGTH) {
    return err(
      indexError('TRUNCATED', 'artefact is shorter than the .clxi format prefix', {
        length: bytes.length,
        required: FORMAT_PREFIX_LENGTH,
      }),
    );
  }
  for (let i = 0; i < CLXI_MAGIC.length; i++) {
    if (bytes[i] !== CLXI_MAGIC[i]) {
      return err(indexError('BAD_MAGIC', 'not a .clxi artefact (magic CLXI expected)', {}));
    }
  }
  const formatVersion = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(
    4,
    true,
  );
  return err(
    indexError('UNSUPPORTED_FORMAT', 'this decoder does not support the .clxi format version', {
      formatVersion,
      supported: SUPPORTED_FORMAT_VERSIONS.join(','),
    }),
  );
};
