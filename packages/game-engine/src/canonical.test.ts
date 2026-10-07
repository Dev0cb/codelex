import { describe, expect, it } from 'vitest';

import * as canonical from './canonical.js';
import { canonicalJson, isJcsInteger, JCS_MAX_DEPTH } from './hash/jcs.js';

describe('@codelex/game-engine/canonical (ADR-0016 §D3.2)', () => {
  it('re-exports the engine serialiser itself, not a copy', () => {
    expect(canonical.canonicalJson).toBe(canonicalJson);
    expect(canonical.isJcsInteger).toBe(isJcsInteger);
    expect(canonical.JCS_MAX_DEPTH).toBe(JCS_MAX_DEPTH);
  });

  it('exports exactly the JCS subset API (SHA-256 stays internal)', () => {
    expect(Object.keys(canonical).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual([
      'JCS_MAX_DEPTH',
      'canonicalJson',
      'isJcsInteger',
    ]);
  });

  it('produces the ADR-0013 Appendix A.3 canonical form', () => {
    expect(canonical.canonicalJson({ z: { k: -7 }, b: 0, a: [3, '?AE'] })).toBe(
      '{"a":[3,"?AE"],"b":0,"z":{"k":-7}}',
    );
  });
});
