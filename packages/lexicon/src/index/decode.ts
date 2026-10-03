import { err, type Result } from '@codelex/config/result';

import { decodeFormat1 } from './clxi/decode.js';
import { FORMAT_VERSION } from './clxi/format.js';

import type {
  LexiconIndex,
  LexiconIndexError,
  LexiconIndexErrorCode,
  LexiconIndexExpectation,
} from './types.js';

/**
 * Pure decoder of a `.clxi` artefact (lexicon-index note §2.2, §3.3). Never throws on bad input; returns a
 * typed error. Zero-copy typed-array views over `bytes` when `bytes.byteOffset` is a multiple of 8, else one
 * copy. Zero-copy views share memory with `bytes`: the loader owns the buffer and must never write to it after
 * decoding (validation runs once, at decode time). `expect` turns a different `lexiconVersion` / profile id into
 * `VERSION_MISMATCH` / `PROFILE_MISMATCH`.
 */
export type DecodeLexiconIndex = (
  bytes: Uint8Array,
  expect?: LexiconIndexExpectation,
) => Result<LexiconIndex, LexiconIndexError>;

/** `CLXI` in ASCII: the first four bytes of every artefact. */
export const CLXI_MAGIC: readonly number[] = Object.freeze([0x43, 0x4c, 0x58, 0x49]);

/** `.clxi` format versions this decoder can read (sprint L4: format 1). */
export const SUPPORTED_FORMAT_VERSIONS: readonly number[] = Object.freeze([FORMAT_VERSION]);

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
 * Reads the format prefix (magic, `formatVersion`), then hands supported formats to their decoder, which validates
 * the whole artefact (CRC-32, sections, DAWG) and applies the `expect` checks (T-VERSION).
 */
export const decodeLexiconIndex: DecodeLexiconIndex = (bytes, expect) => {
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
  if (formatVersion === FORMAT_VERSION) return decodeFormat1(bytes, expect);
  return err(
    indexError('UNSUPPORTED_FORMAT', 'this decoder does not support the .clxi format version', {
      formatVersion,
      supported: SUPPORTED_FORMAT_VERSIONS.join(','),
    }),
  );
};
