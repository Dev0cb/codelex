/**
 * DAWG fallback (BOT-8, bots-api §4.3): P-BOT-03 (unbounded budgets: GADDAG and DAWG generation yield the same set
 * of canonical keys; finite budgets: equal decisions whenever neither path reports `budgetExhausted`), P-BOT-04 on
 * the DAWG path (completeness against brute force), P-BOT-05 (node budget), P-BOT-01 for full matches without a
 * GADDAG. Automata come from the indexes themselves (reference tries and the decoded `.clxi` minimal automata).
 */
import fc from 'fast-check';
import { observe, type Observation } from '@codelex/game-engine';
import type { LexiconIndex } from '@codelex/lexicon/index';
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
  botRng,
  contextFor,
  craftedObservation,
  play,
  positionAfter,
  seedOf,
  spell,
} from '../../test/support/match.js';
import { chooseAction, type BotDecision, type BotPersonalityId } from '../index.js';
import { candidateKey } from '../key.js';
import { selectGenerator } from './index.js';

const TINY = tinyIndex();
const TINY_DAWG = tinyIndex(false);
const REAL = realIndex();
const REAL_DAWG = realIndex({ gaddag: false });
const REAL_CLXI = realIndex({ clxi: true });
const REAL_CLXI_DAWG = realIndex({ clxi: true, gaddag: false });
const SYNTH = syntheticIndex(2000);
const SYNTH_DAWG = syntheticIndex(2000, 1, { gaddag: false });

const sortRack = (rack: string): string =>
  Array.from(rack)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .join('');

function keysOf(obs: Observation, lexicon: LexiconIndex): string[] {
  return generateFor(obs, lexicon)
    .candidates.map((c) => candidateKey(c))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

describe('DAWG generation on crafted positions', () => {
  it('runs without a GADDAG and finds the GADDAG move set on the first move, blanks included', () => {
    expect(selectGenerator(TINY_DAWG).kind).toBe('dawg');
    for (const rack of ['APIDTOS', '?I', '??', 'QXZVWYK', 'TOKENS?']) {
      const obs = craftedObservation(TINY, boardWith([]), sortRack(rack));
      expect(keysOf(obs, TINY_DAWG)).toEqual(keysOf(obs, TINY));
    }
  });

  it('hooks, extends through tiles on both sides and checks cross-words like the GADDAG path', () => {
    const boards = [
      boardWith([...spell('NODE', 7, 6), ...spell('TO', 8, 4)]),
      boardWith([...spell('CODE', 7, 0), ...spell('DATA', 3, 7, 'col')]),
      boardWith([...spell('GIT', 7, 12), ...spell('POD', 12, 7, 'col'), ...spell('AT', 0, 0)]),
    ];
    for (const board of boards) {
      for (const rack of ['SAPICTE', 'NOTES?A', 'DIP']) {
        const obs = craftedObservation(TINY, board, sortRack(rack));
        const dawgKeys = keysOf(obs, TINY_DAWG);
        expect(dawgKeys).toEqual(keysOf(obs, TINY));
        const generated = new Set(dawgKeys);
        for (const k of bruteForceKeys(obs, TINY, 3)) expect(generated).toContain(k);
      }
    }
  });
});

describe('P-BOT-03 same move set (unbounded budgets)', () => {
  const pairs: readonly (readonly [string, LexiconIndex, LexiconIndex])[] = [
    ['real (reference)', REAL, REAL_DAWG],
    ['real (.clxi)', REAL_CLXI, REAL_CLXI_DAWG],
    ['synthetic 2,000', SYNTH, SYNTH_DAWG],
  ];

  it('GADDAG and DAWG yield the same canonical keys on seeded positions and racks', () => {
    let compared = 0;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 24 }),
        fc.option(fc.stringMatching(/^[A-Z?]{1,7}$/), { nil: undefined }),
        fc.constantFrom(...pairs),
        (seed, actions, rack, [, gaddagIndex, dawgIndex]) => {
          const state = positionAfter(gaddagIndex, seedOf(seed), actions, ['greedy', 'beginner']);
          if (state === undefined) return;
          const base = observeOnTurn(state);
          const obs = rack === undefined ? base : { ...base, rack: sortRack(rack) };
          const fromGaddag = keysOf(obs, gaddagIndex);
          expect(keysOf(obs, dawgIndex)).toEqual(fromGaddag);
          compared += fromGaddag.length;
        },
      ),
      { numRuns: 60 },
    );
    expect(compared).toBeGreaterThan(1_000);
  }, 120_000);

  it('the decoded .clxi automata generate exactly what the reference tries generate, node for node', () => {
    for (let i = 0; i < 6; i += 1) {
      const state = positionAfter(REAL, seedOf(40 + i), 2 * i, ['beginner', 'beginner']);
      if (state === undefined) continue;
      const obs = observeOnTurn(state);
      expect(generateFor(obs, REAL_CLXI)).toEqual(generateFor(obs, REAL));
      expect(generateFor(obs, REAL_CLXI_DAWG)).toEqual(generateFor(obs, REAL_DAWG));
    }
  });
});

describe('P-BOT-03 equal decisions with finite budgets', () => {
  const personalities: readonly BotPersonalityId[] = ['random-legal', 'beginner', 'greedy'];

  function decide(obs: Observation, lexicon: LexiconIndex, personality: BotPersonalityId) {
    const result = chooseAction(
      obs,
      contextFor(lexicon, personality, botRng(seedOf(3), obs.seatOnTurn, obs.actionCount)),
    );
    if (!result.ok) throw new Error(result.error.code);
    return result.value;
  }

  it('same decision whenever neither path reports budgetExhausted', () => {
    let equal = 0;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 20 }),
        fc.constantFrom(...personalities),
        (seed, actions, personality) => {
          const state = positionAfter(REAL, seedOf(seed), actions, ['beginner', 'greedy']);
          if (state === undefined) return;
          const obs = observeOnTurn(state);
          const viaGaddag = decide(obs, REAL, personality);
          const viaDawg = decide(obs, REAL_DAWG, personality);
          if (viaGaddag.budgetExhausted || viaDawg.budgetExhausted) return;
          expect(viaDawg.action).toEqual(viaGaddag.action);
          expect(viaDawg.candidatesEvaluated).toBe(viaGaddag.candidatesEvaluated);
          equal += 1;
        },
      ),
      { numRuns: 40 },
    );
    expect(equal).toBeGreaterThan(20);
  }, 120_000);

  it('P-BOT-01 without a GADDAG: full matches through apply, same actions as the GADDAG path', () => {
    for (const seed of [11, 12]) {
      const runs = [REAL, REAL_DAWG].map((lexicon) => {
        const decisions: BotDecision[] = [];
        const final = play({
          lexicon,
          seed: seedOf(seed),
          personalities: ['beginner', 'greedy'],
          onStep: ({ decision }) => decisions.push(decision),
        });
        return { decisions, final };
      });
      const [viaGaddag, viaDawg] = runs;
      if (viaGaddag === undefined || viaDawg === undefined) throw new Error('unreachable');
      expect(viaDawg.final.status).toBe('finished');
      if ([...viaGaddag.decisions, ...viaDawg.decisions].every((d) => !d.budgetExhausted)) {
        expect(viaDawg.decisions.map((d) => d.action)).toEqual(
          viaGaddag.decisions.map((d) => d.action),
        );
        expect(observe(viaDawg.final, 0)).toEqual(observe(viaGaddag.final, 0));
      }
    }
  }, 120_000);
});

describe('P-BOT-05 node budget on the DAWG path (BOT-3, BOT-4)', () => {
  const state = positionAfter(REAL, seedOf(7), 6, ['greedy', 'greedy']);
  if (state === undefined) throw new Error('fixture match ended early');
  const obs = { ...observeOnTurn(state), rack: '?AEINST' };
  const full = generateFor(obs, REAL_DAWG);

  it('unbounded generation is not exhausted and is reproducible at its exact node count', () => {
    expect(full.nodesUsed).toBeGreaterThan(100);
    expect(full.exhausted).toBe(false);
    expect(generateFor(obs, REAL_DAWG, full.nodesUsed)).toEqual(full);
    expect(generateFor(obs, REAL_DAWG, UNBOUNDED)).toEqual(full);
  });

  it('a cap below the need stops early, reports exhaustion and keeps a prefix', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: full.nodesUsed - 1 }), (maxNodes) => {
        const capped = generateFor(obs, REAL_DAWG, maxNodes);
        expect(capped.nodesUsed).toBe(maxNodes);
        expect(capped.exhausted).toBe(true);
        expect(capped.candidates).toEqual(full.candidates.slice(0, capped.candidates.length));
      }),
      { numRuns: 50 },
    );
  });
});
