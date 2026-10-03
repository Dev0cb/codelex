/**
 * GADDAG generation: P-BOT-04 (soundness: every candidate accepted by evaluateMove; completeness: ⊇ brute force
 * over placements of ≤ 3 rack tiles on a tiny lexicon), P-BOT-05 (node budget), BOT-3 node definition, dedupe.
 */
import fc from 'fast-check';
import { evaluateMove } from '@codelex/game-engine';
import { describe, expect, it } from 'vitest';
import {
  bruteForceKeys,
  generateFor,
  observeOnTurn,
  UNBOUNDED,
} from '../../test/support/generation.js';
import { realIndex, syntheticIndex, tinyIndex } from '../../test/support/lexicons.js';
import {
  boardWith,
  craftedObservation,
  positionAfter,
  seedOf,
  spell,
} from '../../test/support/match.js';
import { selectGenerator } from './index.js';

const REAL = realIndex();
const TINY = tinyIndex();
const SYNTH = syntheticIndex(2000);

describe('first move', () => {
  it('covers the start square with ≥ 2 tiles and finds both directions', () => {
    const obs = craftedObservation(TINY, boardWith([]), 'APIDTOS');
    const gen = generateFor(obs, TINY);
    expect(gen.exhausted).toBe(false);
    expect(gen.candidates.length).toBeGreaterThan(0);
    for (const c of gen.candidates) {
      expect(c.tilesPlaced).toBeGreaterThanOrEqual(2);
      expect(c.action.tiles.some((t) => t.row === 7 && t.col === 7)).toBe(true);
      expect(evaluateMove(obs, c.action, { lexicon: TINY }).ok).toBe(true);
    }
    const keys = gen.candidates.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain('P0707A0708P0709I');
    expect(keys).toContain('P0707A0807P0907I');
    expect(bruteForceKeys(obs, TINY, 3)).toEqual(
      new Set(keys.filter((k) => (k.length - 1) / 5 <= 3)),
    );
  });

  it('places blanks lowercase, after natural letters', () => {
    const obs = craftedObservation(TINY, boardWith([]), '?I');
    const keys = generateFor(obs, TINY).candidates.map((c) => c.key);
    expect(keys).toContain('P0706a0707I');
    expect(keys).toContain('P0707I0708p');
    expect(keys.every((k) => /[a-z]/.test(k))).toBe(true);
  });
});

describe('extending a board', () => {
  const board = boardWith([...spell('NODE', 7, 6), ...spell('TO', 8, 4)]);

  it('hooks, extends through existing tiles and checks cross-words', () => {
    const obs = craftedObservation(TINY, board, 'SAPICTE');
    const gen = generateFor(obs, TINY);
    const keys = gen.candidates.map((c) => c.key);
    expect(keys).toContain('P0710S'); // NODES
    for (const c of gen.candidates) {
      expect(evaluateMove(obs, c.action, { lexicon: TINY }).ok).toBe(true);
    }
    const generated = new Set(keys);
    for (const k of bruteForceKeys(obs, TINY, 3)) expect(generated).toContain(k);
  });

  it('selects the GADDAG when the index has one, the DAWG otherwise (BOT-8)', () => {
    expect(selectGenerator(TINY).kind).toBe('gaddag');
    expect(selectGenerator(tinyIndex(false)).kind).toBe('dawg');
  });
});

describe('P-BOT-04 on seeded mid-game positions', () => {
  it('soundness on the real index and a 2,000-form synthetic index', () => {
    let checked = 0;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 24 }),
        fc.constantFrom(REAL, SYNTH),
        (seed, actions, lexicon) => {
          const state = positionAfter(lexicon, seedOf(seed), actions, ['greedy', 'beginner']);
          if (state === undefined) return;
          const obs = observeOnTurn(state);
          const gen = generateFor(obs, lexicon);
          checked += gen.candidates.length;
          expect(gen.exhausted).toBe(false);
          for (const c of gen.candidates) {
            const result = evaluateMove(obs, c.action, { lexicon });
            expect(result.ok).toBe(true);
            if (result.ok) expect(result.value.action).toEqual(c.action);
          }
        },
      ),
      { numRuns: 25 },
    );
    expect(checked).toBeGreaterThan(500);
  }, 60_000);

  it('completeness against brute force (≤ 3 tiles, blanks included) on the tiny lexicon', () => {
    let oracleMoves = 0;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 8 }),
        fc.stringMatching(/^[ADEINOPSTC?]{3,6}$/),
        (seed, actions, rack) => {
          const state = positionAfter(TINY, seedOf(seed), actions, ['greedy', 'random-legal']);
          if (state === undefined) return;
          const obs = {
            ...observeOnTurn(state),
            rack: Array.from(rack)
              .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
              .join(''),
          };
          const generated = new Set(generateFor(obs, TINY).candidates.map((c) => c.key));
          const oracle = bruteForceKeys(obs, TINY, 3);
          oracleMoves += oracle.size;
          for (const k of oracle) expect(generated).toContain(k);
        },
      ),
      { numRuns: 30 },
    );
    expect(oracleMoves).toBeGreaterThan(100);
  }, 60_000);
});

describe('P-BOT-05 node budget (BOT-3, BOT-4)', () => {
  const state = positionAfter(REAL, seedOf(7), 6, ['greedy', 'greedy']);
  if (state === undefined) throw new Error('fixture match ended early');
  const obs = { ...observeOnTurn(state), rack: '?AEINST' };
  const full = generateFor(obs, REAL);

  it('unbounded generation uses some nodes and is not exhausted', () => {
    expect(full.nodesUsed).toBeGreaterThan(100);
    expect(full.exhausted).toBe(false);
    expect(generateFor(obs, REAL, full.nodesUsed)).toEqual(full);
  });

  it('a cap below the need stops early, reports exhaustion and keeps a prefix', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: full.nodesUsed - 1 }), (maxNodes) => {
        const capped = generateFor(obs, REAL, maxNodes);
        expect(capped.nodesUsed).toBe(maxNodes);
        expect(capped.exhausted).toBe(true);
        expect(capped.candidates).toEqual(full.candidates.slice(0, capped.candidates.length));
      }),
      { numRuns: 50 },
    );
  });

  it('counts nodes identically on repeated runs', () => {
    expect(generateFor(obs, REAL, UNBOUNDED)).toEqual(full);
  });
});
