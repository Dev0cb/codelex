import type { Result } from '@codelex/config/result';
import {
  decodeLexiconIndex,
  isLexiconVersion,
  type DecodeLexiconIndex,
  type LexiconIndex,
  type LexiconIndexErrorCode,
  type LexiconVersion,
} from '@codelex/lexicon/index';

/**
 * What `prepare:lexicon` (scripts/lexicon-asset.mjs) writes next to the bundled `.clxi`: the identity the loader
 * expects, and the size and sha256 the bytes must match (mobile-app-foundation note §3).
 */
export interface LexiconAssetDescriptor {
  readonly lexiconVersion: LexiconVersion;
  readonly profileId: string;
  /** `.clxi` header flags; bit 0 = GADDAG section present. */
  readonly flags: number;
  readonly sha256: string;
  readonly bytes: number;
}

/**
 * E-1.5 §5.10.1 codes: `LEXICON_INDEX_MISSING` (no usable descriptor, or the asset cannot be read),
 * `LEXICON_INDEX_CORRUPT` (size, digest or GADDAG presence differ from the descriptor), else the decoder's code
 * (`VERSION_MISMATCH`, `CORRUPT`, ...).
 */
export type LexiconLoadErrorCode =
  'LEXICON_INDEX_MISSING' | 'LEXICON_INDEX_CORRUPT' | LexiconIndexErrorCode;

export interface LexiconLoadError {
  readonly code: LexiconLoadErrorCode;
  /** Developer diagnostics only; never shown to the player. */
  readonly message: string;
}

/** Platform side of the loader, injected so the logic stays pure and unit-testable. */
export interface LexiconSource {
  /** The bundled descriptor, untrusted until parsed. */
  readonly descriptor: unknown;
  /** Reads the asset into a fresh buffer the loader owns (lexicon-index note §3.5, ownership). */
  readBytes(): Promise<Uint8Array>;
  /** Lowercase hex SHA-256 computed natively (expo-crypto on device). */
  sha256Hex(bytes: Uint8Array): Promise<string>;
}

export interface LoadedLexicon {
  readonly index: LexiconIndex;
  readonly descriptor: LexiconAssetDescriptor;
}

export type LexiconLoadResult = Result<LoadedLexicon, LexiconLoadError>;

const HEX64 = /^[0-9a-f]{64}$/;
const PROFILE_ID = /^[a-z0-9][a-z0-9-]*$/;
const GADDAG_FLAG = 1;

const fail = (code: LexiconLoadErrorCode, message: string): LexiconLoadResult => ({
  ok: false,
  error: { code, message },
});

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Parses the bundled descriptor; `undefined` when any field is missing or malformed. */
export function parseLexiconAssetDescriptor(value: unknown): LexiconAssetDescriptor | undefined {
  if (!isRecord(value)) return undefined;
  const { lexiconVersion, profileId, flags, sha256, bytes } = value;
  if (
    typeof lexiconVersion !== 'string' ||
    !isLexiconVersion(lexiconVersion) ||
    typeof profileId !== 'string' ||
    !PROFILE_ID.test(profileId) ||
    typeof flags !== 'number' ||
    !Number.isInteger(flags) ||
    flags < 0 ||
    flags > 0xffff ||
    typeof sha256 !== 'string' ||
    !HEX64.test(sha256) ||
    typeof bytes !== 'number' ||
    !Number.isInteger(bytes) ||
    bytes <= 0
  ) {
    return undefined;
  }
  return { lexiconVersion, profileId, flags, sha256, bytes };
}

/** Lowercase hex of a digest. */
export function toHex(digest: Uint8Array): string {
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : 'unknown');

/**
 * Loads the bundled lexicon index (lexicon-index note §3.5, mobile-app-foundation note §3.2): read the bytes, check
 * size and sha256 against the descriptor, decode once with the expected version and profile, check the GADDAG
 * presence against the flags. Never throws; any failure is a typed error and no index (never partial play).
 */
export async function loadLexicon(
  source: LexiconSource,
  decode: DecodeLexiconIndex = decodeLexiconIndex,
): Promise<LexiconLoadResult> {
  const descriptor = parseLexiconAssetDescriptor(source.descriptor);
  if (descriptor === undefined) {
    return fail('LEXICON_INDEX_MISSING', 'bundled lexicon descriptor is missing or malformed');
  }
  let bytes: Uint8Array;
  try {
    bytes = await source.readBytes();
  } catch (error) {
    return fail('LEXICON_INDEX_MISSING', `cannot read the lexicon asset: ${describe(error)}`);
  }
  if (bytes.length !== descriptor.bytes) {
    return fail(
      'LEXICON_INDEX_CORRUPT',
      `asset is ${String(bytes.length)} B, descriptor says ${String(descriptor.bytes)} B`,
    );
  }
  let digest: string;
  try {
    digest = await source.sha256Hex(bytes);
  } catch (error) {
    return fail('LEXICON_INDEX_CORRUPT', `cannot hash the lexicon asset: ${describe(error)}`);
  }
  if (digest.toLowerCase() !== descriptor.sha256) {
    return fail('LEXICON_INDEX_CORRUPT', 'asset sha256 differs from the descriptor');
  }
  const decoded = decode(bytes, {
    version: descriptor.lexiconVersion,
    profileId: descriptor.profileId,
  });
  if (!decoded.ok) return fail(decoded.error.code, decoded.error.message);
  const index = decoded.value;
  const expectsGaddag = (descriptor.flags & GADDAG_FLAG) !== 0;
  if ((index.gaddag !== undefined) !== expectsGaddag) {
    return fail('LEXICON_INDEX_CORRUPT', 'GADDAG presence differs from the descriptor flags');
  }
  return { ok: true, value: { index, descriptor } };
}
