import { describe, expect, it } from 'vitest';

import * as canonical from './canonical.js';
import { canonicalJson, isJcsInteger, JCS_MAX_DEPTH } from './hash/jcs.js';
import { asciiBytes, sha256Hex } from './hash/sha256.js';

describe('@codelex/game-engine/canonical (ADR-0016 §D3.2)', () => {
  it('re-exports the engine serialiser itself, not a copy', () => {
    expect(canonical.canonicalJson).toBe(canonicalJson);
    expect(canonical.isJcsInteger).toBe(isJcsInteger);
    expect(canonical.JCS_MAX_DEPTH).toBe(JCS_MAX_DEPTH);
    expect(canonical.sha256Hex).toBe(sha256Hex);
    expect(canonical.asciiBytes).toBe(asciiBytes);
  });

  it('exports exactly the JCS subset API and the SHA-256 the golden runner needs (sprint 4 P3)', () => {
    expect(Object.keys(canonical).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual([
      'JCS_MAX_DEPTH',
      'asciiBytes',
      'canonicalJson',
      'isJcsInteger',
      'sha256Hex',
    ]);
  });

  it('hashes canonical text as ADR-0013 §D3 does (Appendix A.3 digest)', () => {
    const text = canonical.canonicalJson({ z: { k: -7 }, b: 0, a: [3, '?AE'] });
    expect(canonical.sha256Hex(canonical.asciiBytes(text))).toBe(
      '29cb9747b6a7224168208f209044e3d24573275df767bf9d09003cf5ef3ef7cb',
    );
  });

  it('produces the ADR-0013 Appendix A.3 canonical form', () => {
    expect(canonical.canonicalJson({ z: { k: -7 }, b: 0, a: [3, '?AE'] })).toBe(
      '{"a":[3,"?AE"],"b":0,"z":{"k":-7}}',
    );
  });
});
