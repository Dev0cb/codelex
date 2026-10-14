/**
 * Suites `sha256` (FIPS 180-4 / NIST vectors, `sha256.json`) and `jcs` (ADR-0013 §D3 and Appendix A.3,
 * `jcs.json`), through `@codelex/game-engine/canonical` only: the serialiser and SHA-256 the state hash uses.
 */
import { asciiBytes, canonicalJson, sha256Hex } from '@codelex/game-engine/canonical';

import type { CaseSpec } from '../cases.js';
import { JCS_PATH, SHA256_PATH, type GoldenCorpus } from '../corpus.js';

export const SHA256_SUITE = 'sha256';
export const JCS_SUITE = 'jcs';

/** `hash16` of ADR-0013 §D3: the first 16 hex characters of the SHA-256. */
const HASH16_LENGTH = 16;

/** Case id = the vector name (`empty`, `abc`, …, `one million a`). */
export function sha256Cases(corpus: GoldenCorpus): CaseSpec[] {
  return corpus[SHA256_PATH].cases.map((c) => ({
    id: c.name,
    run: () => ({
      observed: sha256Hex(asciiBytes(c.input.repeat(c.count))),
      expected: c.digest,
    }),
  }));
}

/** The constructor name of what `canonicalJson` throws on a rejected input, or `accepted`. */
function rejectionOf(value: unknown): string {
  try {
    canonicalJson(value);
    return 'accepted';
  } catch (error) {
    return error instanceof Error ? error.name : 'unknown';
  }
}

/**
 * `cases/<name>`: canonical text and SHA-256 of the decoded `input` (JSON text, `JSON.parse` as in the engine
 * test). `rejections/<name>`: the error kind `canonicalJson` throws (`TypeError` or `RangeError`).
 */
export function jcsCases(corpus: GoldenCorpus): CaseSpec[] {
  const file = corpus[JCS_PATH];
  const accepted: CaseSpec[] = file.cases.map((c) => ({
    id: `cases/${c.name}`,
    run: () => {
      const text = canonicalJson(JSON.parse(c.input) as unknown);
      const digest = sha256Hex(asciiBytes(text));
      return {
        observed: { jcs: text, sha256: digest, hash16: digest.slice(0, HASH16_LENGTH) },
        expected: { jcs: c.jcs, sha256: c.sha256, hash16: c.hash16 },
      };
    },
  }));
  const rejected: CaseSpec[] = file.rejections.map((r) => ({
    id: `rejections/${r.name}`,
    run: () => ({ observed: rejectionOf(JSON.parse(r.input) as unknown), expected: r.error }),
  }));
  return [...accepted, ...rejected];
}
