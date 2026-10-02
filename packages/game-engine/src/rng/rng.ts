/**
 * Deterministic RNG of ADR-0013 §D1: xoshiro128** 1.1 over named streams derived from a 64-bit seed.
 * 32-bit integer maths only (`Math.imul`, `>>> 0`): bit-identical on Node and Hermes. No BigInt, no floats.
 */
import { asciiBytes, sha256 } from '../hash/sha256.js';

/** Identifier written into golden files (`rng.json` `algorithm`). Part of `engineRulesVersion`. */
export const RNG_ALGORITHM = 'xoshiro128**-1.1';
/** Stream derivation identifier written into golden files (`rng.json` `derivation`). */
export const RNG_DERIVATION = "sha256(seedHex ':' stream)[0..16) as 4 big-endian u32";

/** The four unsigned 32-bit words `s0..s3` of a xoshiro128** generator (never all zero). */
export type RngState = readonly [number, number, number, number];

/** A seeded generator. Mutable by design: `apply` creates one from state and stores `state()` back. */
export interface Rng {
  /** One xoshiro128** step: a uniform unsigned 32-bit integer. */
  next(): number;
  /**
   * Uniform integer in `[lo, hi)` by rejection sampling. Requires safe integers with `lo < hi` and
   * `hi - lo <= 2^32` (else throws `RangeError`, a programmer error). Always consumes at least one output.
   */
  int(lo: number, hi: number): number;
  /** Fisher–Yates (descending) shuffle of a copy of `items`; `items` is never modified. */
  shuffle<T>(items: readonly T[]): T[];
  /** Frozen snapshot of the current state, e.g. to persist `rng.bag` in the match state. */
  state(): RngState;
}

const TWO_POW_32 = 0x1_0000_0000;
const SEED_PATTERN = /^[0-9a-f]{16}$/;
// ADR-0013 §D1: `^[a-z][a-z0-9-]*(:[0-9]+)*$` with decimal integers without leading zeros.
const STREAM_PATTERN = /^[a-z][a-z0-9-]*(?::(?:0|[1-9][0-9]*))*$/;

/** A seed is exactly 16 lowercase hex characters (64 bits), e.g. `00c0de1e00000001`. */
export function isSeedHex(seed: string): boolean {
  return SEED_PATTERN.test(seed);
}

/** A stream name such as `bag`, `first-player` or `bot:<seat>:<n>`. */
export function isStreamName(stream: string): boolean {
  return STREAM_PATTERN.test(stream);
}

function isU32(x: number): boolean {
  return Number.isInteger(x) && x >= 0 && x < TWO_POW_32;
}

/** Rotate left; valid for 1 ≤ k ≤ 31 only (k = 0 would compute `x >>> 32`, which is `x`). Used with 7 and 11. */
function rotl(x: number, k: number): number {
  return ((x << k) | (x >>> (32 - k))) >>> 0;
}

/**
 * State from a SHA-256 digest: bytes 0..15 read as four big-endian u32; an all-zero result (probability
 * 2^-128) becomes `[1, 0, 0, 0]`, since xoshiro128** must not start from the zero state.
 */
export function stateFromDigest(digest: Uint8Array): RngState {
  if (digest.length < 16) throw new RangeError('stateFromDigest: need at least 16 bytes');
  const word = (i: number): number =>
    (((digest[i] as number) << 24) |
      ((digest[i + 1] as number) << 16) |
      ((digest[i + 2] as number) << 8) |
      (digest[i + 3] as number)) >>>
    0;
  const s0 = word(0);
  const s1 = word(4);
  const s2 = word(8);
  const s3 = word(12);
  if ((s0 | s1 | s2 | s3) === 0) return Object.freeze([1, 0, 0, 0] as const);
  return Object.freeze([s0, s1, s2, s3] as const);
}

/** `SHA-256(ASCII(seedHex + ":" + streamName))[0..16)` as four big-endian u32 (ADR-0013 §D1). */
export function deriveStreamState(seedHex: string, streamName: string): RngState {
  if (!isSeedHex(seedHex))
    throw new RangeError('deriveStreamState: seed must match ^[0-9a-f]{16}$');
  if (!isStreamName(streamName))
    throw new RangeError(`deriveStreamState: invalid stream name "${streamName}"`);
  return stateFromDigest(sha256(asciiBytes(`${seedHex}:${streamName}`)));
}

/** Generator starting from `state`, which is copied (never mutated). Throws on an invalid state. */
export function createRng(state: RngState): Rng {
  // Checked at runtime too: persisted states are deserialised data.
  const words: unknown = state;
  if (
    !Array.isArray(words) ||
    words.length !== 4 ||
    !words.every((w) => typeof w === 'number' && isU32(w))
  ) {
    throw new RangeError('createRng: state must be four unsigned 32-bit integers');
  }
  let [s0, s1, s2, s3] = state;
  if ((s0 | s1 | s2 | s3) === 0) throw new RangeError('createRng: the all-zero state is forbidden');

  function next(): number {
    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);
    return result;
  }

  function int(lo: number, hi: number): number {
    if (
      !Number.isSafeInteger(lo) ||
      !Number.isSafeInteger(hi) ||
      lo >= hi ||
      hi - lo > TWO_POW_32
    ) {
      throw new RangeError('int(lo, hi): need safe integers with lo < hi and hi - lo <= 2^32');
    }
    const n = hi - lo;
    const limit = TWO_POW_32 - (TWO_POW_32 % n);
    let x = next();
    while (x >= limit) x = next();
    return lo + (x % n);
  }

  function shuffle<T>(items: readonly T[]): T[] {
    const a = [...items];
    for (let i = a.length - 1; i >= 1; i--) {
      const j = int(0, i + 1);
      const tmp = a[i] as T;
      a[i] = a[j] as T;
      a[j] = tmp;
    }
    return a;
  }

  return {
    next,
    int,
    shuffle,
    state: () => Object.freeze([s0, s1, s2, s3] as const),
  };
}

/** Generator of the named stream of a match seed: `createRng(deriveStreamState(seedHex, streamName))`. */
export function deriveRng(seedHex: string, streamName: string): Rng {
  return createRng(deriveStreamState(seedHex, streamName));
}
