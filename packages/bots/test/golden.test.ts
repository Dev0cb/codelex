/**
 * Golden decisions pinned per (BOT_VERSION, engineRulesVersion) (bots-api §5.6, §7; spec AC-12). A failure means
 * behaviour changed: if intended, bump BOT_VERSION and add `golden/decisions-b<N>-r<R>.json` from `computeGolden`
 * for review. Never edit a published file to make a failing test pass.
 *
 * Pinned to the seeded 2,000-form synthetic fixture, not the real data: curator batches change the real lexicon
 * every sprint and must not break the bots' golden. Real-data behaviour is covered by properties. The fixture is
 * the shipped artefact shape: a built and decoded `.clxi`, with the GADDAG section (f1, what the app bundles,
 * lexicon P7) and without it (f0, the DAWG fallback).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BOT_VERSION } from '../src/index.js';
import {
  computeGolden,
  decisionAt,
  GOLDEN_PERSONALITIES,
  goldenPositions,
  type GoldenFile,
  type GoldenFileV1,
} from './support/golden.js';
import { syntheticIndex } from './support/lexicons.js';

const ENGINE_RULES_VERSION = 1;

function read(name: string): unknown {
  return JSON.parse(readFileSync(join(import.meta.dirname, 'golden', name), 'utf8'));
}

const golden = read(
  `decisions-b${String(BOT_VERSION)}-r${String(ENGINE_RULES_VERSION)}.json`,
) as GoldenFile;
const F1 = syntheticIndex(2000, 1, { clxi: true });
const F0 = syntheticIndex(2000, 1, { clxi: true, gaddag: false });

describe('golden decisions', () => {
  it('covers 20 positions × 4 personalities, keyed by (BOT_VERSION, engineRulesVersion), on f1', () => {
    expect(golden.botVersion).toBe(BOT_VERSION);
    expect(golden.engineRulesVersion).toBe(ENGINE_RULES_VERSION);
    expect(golden.automaton).toBe('gaddag');
    expect(golden.decisions).toHaveLength(20 * GOLDEN_PERSONALITIES.length);
    // Positions are chosen so that no cap binds (bots-api §5.6): every decision is also asserted on f0.
    expect(golden.capBoundDecisions).toBe(0);
    expect(golden.decisions.every((d) => !d.budgetExhausted)).toBe(true);
  });

  it('reproduces every pinned decision on the shipped automaton (f1)', () => {
    expect(F1.version).toBe(golden.lexiconVersion);
    expect(F1.gaddag).toBeDefined();
    expect(computeGolden(F1)).toEqual(golden);
  });

  it('f0 (DAWG only) decides the same wherever no cap binds (P-BOT-03)', () => {
    expect(F0.gaddag).toBeUndefined();
    const positions = goldenPositions(F1);
    let compared = 0;
    for (const pinned of golden.decisions) {
      if (pinned.budgetExhausted) continue;
      const position = positions.find((p) => p.seed === pinned.seed);
      if (position === undefined) throw new Error(`position ${pinned.seed} missing`);
      const viaDawg = decisionAt(F0, position, pinned.personality);
      expect(viaDawg.key).toBe(pinned.key);
      expect(viaDawg.candidatesEvaluated).toBe(pinned.candidatesEvaluated);
      compared += 1;
    }
    expect(compared).toBe(golden.decisions.length - golden.capBoundDecisions);
  });

  // decisions-v1.json last reproduced at commit 67361da (B4 cheaper key build, still BOT_VERSION 1): the proof that
  // the key build was a pure refactor. From BOT_VERSION 2 it is a frozen record; its SHA-256 is pinned so any edit
  // fails here, not only in review.
  it('keeps the BOT_VERSION 1 record frozen (not executed: bot reasoning is never replayed)', () => {
    const bytes = readFileSync(join(import.meta.dirname, 'golden', 'decisions-v1.json'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      'cd063d6e78c479506e1ad8fabcaa68d139ebbcadb6a3c8bd5f5584739905c6fc',
    );
    const v1 = read('decisions-v1.json') as GoldenFileV1;
    expect(v1.botVersion).toBe(1);
    expect(v1.decisions).toHaveLength(60);
  });
});
