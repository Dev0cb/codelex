import { describe, expect, it } from 'vitest';

import * as engine from './index.js';
import * as rng from './rng/index.js';

describe('public API', () => {
  it('exports ENGINE_RULES_VERSION = 1 (ADR-0013 §D5)', () => {
    expect(engine.ENGINE_RULES_VERSION).toBe(1);
  });

  it('exports the JCS subset serialiser and hash16 (ADR-0013 §D3, Appendix A.3)', () => {
    const input = { z: { k: -7 }, b: 0, a: [3, '?AE'] };
    expect(engine.canonicalJson(input)).toBe('{"a":[3,"?AE"],"b":0,"z":{"k":-7}}');
    expect(engine.hash16(input)).toBe('29cb9747b6a72241');
  });

  it('re-exports the @codelex/game-engine/rng subpath from the root', () => {
    expect(Object.keys(rng).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(rng)) {
      expect(engine[name as keyof typeof engine], name).toBe(value);
    }
  });
});
