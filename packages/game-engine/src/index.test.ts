import { describe, expect, it } from 'vitest';

import * as engine from './index.js';
import * as rng from './rng/index.js';

describe('public API (API note §3, §13)', () => {
  it('exports ENGINE_RULES_VERSION = 1 and LOG_VERSION = 1 (ADR-0013 §D2, §D5)', () => {
    expect(engine.ENGINE_RULES_VERSION).toBe(1);
    expect(engine.LOG_VERSION).toBe(1);
  });

  it('exports exactly the functions of the API note; hashing stays internal', () => {
    const functions = Object.entries(engine)
      .filter(([, v]) => typeof v === 'function')
      .map(([k]) => k)
      .filter((k) => !(k in rng))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(functions).toEqual([
      'apply',
      'createMatch',
      'evaluateMove',
      'eventsFor',
      'getLayout',
      'getLetterTable',
      'isRulesVersion',
      'newActionLog',
      'observe',
      'parseActionLog',
      'parseState',
      'previewScore',
      'replay',
      'rulesDigest',
      'rulesFor',
      'serializeActionLog',
      'serializeState',
      'stateHash',
    ]);
    expect(engine).not.toHaveProperty('sha256');
    expect(engine).not.toHaveProperty('canonicalJson');
  });

  it('re-exports the @codelex/game-engine/rng subpath from the root', () => {
    expect(Object.keys(rng).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(rng)) {
      expect(engine[name as keyof typeof engine], name).toBe(value);
    }
  });
});
