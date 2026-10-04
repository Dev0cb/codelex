/**
 * Properties that must hold for EVERY registered rules version (ADR-0014 E6 acceptance): one code path, so the same
 * properties run for v1 and for each v2 draft variant (`test/support/variants.ts`).
 * - P-API-01: `evaluateMove` ≡ `apply` on acceptance, rejection and breakdown;
 * - P-API-07: `replay` of every generated match reaches the same state and hash; a flipped hash pinpoints its index;
 * - P-GLOBAL-04: `parseState(serializeState(s))` deep-equals `s`;
 * - R-TURN-004: the scoreless-turn limit always ends a match (exactly at 3 × active seats), and every match
 *   terminates within a bound that only depends on the tile count.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  chooseAction,
  harnessRng,
  legalMoves,
  playSteps,
  seedOf,
  simConfig,
  type Variant,
} from '../../test/support/play.js';
import { VARIANTS } from '../../test/support/variants.js';
import { ALLOW_DRAFT_RULES } from '../draft.js';
import { newActionLog, parseActionLog, replay, serializeActionLog } from '../replay/log.js';
import type { Rng } from '../rng/index.js';
import { getLetterTable } from '../rules/constants.js';
import { parseState, serializeState, stateHash } from '../state/state.js';
import { chars } from '../tiles.js';
import type { Action, MatchState, RackTile, StateHash } from '../types.js';
import { apply } from './apply.js';
import { createMatch } from './create.js';
import { evaluateMove, observe } from './observe.js';

const OPTS = { draft: { optIn: ALLOW_DRAFT_RULES } };
const CASES = VARIANTS.map((v) => [v.id, v] as const);

/** A generated state of `variant`: random seed, seat count and number of steps (finished states included). */
const generated = (variant: Variant) =>
  fc
    .tuple(fc.nat(5000), fc.constantFrom(2, 3, 4), fc.nat(60))
    .map(([i, seats, steps]) => ({ i, played: playSteps(seedOf(i), seats, steps, variant) }));

describe.each(CASES)('P-API-01 per rules version: evaluateMove ≡ apply (%s)', (_id, variant) => {
  it('legal moves and their shifted mutants: same acceptance, rejection and breakdown', () => {
    let accepted = 0;
    fc.assert(
      fc.property(generated(variant), ({ i, played }) => {
        const s = played.states.at(-1) as MatchState;
        if (s.status === 'finished') return;
        const seat = s.seatOnTurn;
        const rng = harnessRng(seedOf(i + 3));
        for (const move of legalMoves(s, rng, 3, variant.ctx)) {
          const shifted = {
            ...move.action,
            tiles: move.action.tiles.map((t) => ({ ...t, col: t.col + 1 })),
          };
          for (const action of [move.action, shifted]) {
            const applied = apply(s, action, variant.ctx);
            const evaluated = evaluateMove(observe(s, seat), action, variant.ctx);
            expect(evaluated.ok).toBe(applied.ok);
            if (!evaluated.ok && !applied.ok) expect(evaluated.error).toEqual(applied.error);
            if (evaluated.ok && applied.ok) {
              accepted += 1;
              const placed = applied.value.events.find((e) => e.type === 'WORD_PLACED');
              expect(placed?.type === 'WORD_PLACED' && placed.breakdown).toEqual(
                evaluated.value.breakdown,
              );
            }
          }
        }
      }),
      { seed: 1401, numRuns: 25 },
    );
    expect(accepted).toBeGreaterThan(0);
  }, 120_000);
});

describe.each(CASES)('P-API-07 / P-GLOBAL-04 per rules version (%s)', (_id, variant) => {
  it('replay reaches every state hash; a flipped hash pinpoints its index; state and log round-trip', () => {
    fc.assert(
      fc.property(generated(variant), fc.nat(1000), ({ played }, pick) => {
        const log = { ...newActionLog(played.config), actions: played.actions };
        const recorded = replay(log, variant.ctx, { recordHashes: true });
        if (!recorded.ok) throw new Error(JSON.stringify(recorded.error));
        const last = played.states.at(-1) as MatchState;
        expect(recorded.value.state).toEqual(last);
        expect(recorded.value.finalHash).toBe(stateHash(last));
        const hashes = recorded.value.stateHashes ?? [];
        expect(hashes).toEqual(played.states.slice(1).map(stateHash));
        const withHashes = { ...log, stateHashes: hashes };
        expect(parseActionLog(serializeActionLog(withHashes), OPTS)).toEqual({
          ok: true,
          value: withHashes,
        });
        expect(parseState(serializeState(last), OPTS)).toEqual({ ok: true, value: last });
        if (hashes.length === 0) return;
        const at = pick % hashes.length;
        const flipped = hashes.map((h, k) => (k === at ? ('f'.repeat(16) as StateHash) : h));
        expect(replay({ ...log, stateHashes: flipped }, variant.ctx)).toMatchObject({
          ok: false,
          error: { code: 'HASH_MISMATCH', details: { index: at } },
        });
      }),
      { seed: 1402, numRuns: 20 },
    );
  }, 120_000);
});

/** A scoreless action of the seat on turn: PASS, or an EXCHANGE when the bag allows it (R-TURN-001). */
function scoreless(s: MatchState, rng: Rng, minBag: number): Action {
  const seat = s.seatOnTurn;
  const rack = s.seats[seat]?.rack ?? '';
  if (s.bag.length >= minBag && rack.length > 0 && rng.int(0, 2) === 0) {
    const tiles = rng.shuffle(chars(rack)).slice(0, rng.int(1, rack.length + 1)) as RackTile[];
    return { seat, type: 'EXCHANGE', tiles };
  }
  return { seat, type: 'PASS' };
}

const activeSeats = (s: MatchState): number => s.seats.filter((x) => x.status === 'active').length;

describe.each(CASES)('R-TURN-004 always terminates (%s)', (_id, variant) => {
  it('R-TURN-004 (Q-GD-1): from any reachable state, scoreless turns end the match exactly at 3 × active seats', () => {
    fc.assert(
      fc.property(generated(variant), ({ i, played }) => {
        let s = played.states.at(-1) as MatchState;
        if (s.status === 'finished') return;
        const limit = 3 * activeSeats(s);
        const remaining = limit - s.scorelessTurns;
        expect(remaining).toBeGreaterThan(0);
        const rng = harnessRng(seedOf(i + 5));
        for (let turn = 1; turn <= remaining; turn += 1) {
          const r = apply(s, scoreless(s, rng, 7), variant.ctx);
          if (!r.ok) throw new Error(JSON.stringify(r.error));
          s = r.value.state;
          expect(s.status).toBe(turn === remaining ? 'finished' : 'in_progress');
        }
        expect(s.result?.end).toEqual({ reason: 'scoreless_turns' });
        expect(s.scorelessTurns).toBe(limit);
      }),
      { seed: 1403, numRuns: 40 },
    );
  }, 120_000);

  it('every match ends within (tiles + 1) × 3 × seats + tiles + seats actions, whatever mix of moves, exchanges, passes and resignations', () => {
    const tiles = (() => {
      const t = getLetterTable(variant.letters);
      return t.counts.reduce((a, b) => a + b, 0) + t.blanks;
    })();
    fc.assert(
      fc.property(fc.nat(5000), fc.constantFrom(2, 3, 4), fc.nat(3), (i, seats, stall) => {
        // Each PLACE_WORD consumes ≥ 1 tile for good (≤ `tiles` of them); between two of them at most
        // 3 × seats − 1 scoreless turns; each seat resigns at most once.
        const bound = (tiles + 1) * 3 * seats + tiles + seats;
        const created = createMatch(simConfig(seedOf(i), seats, variant), variant.ctx);
        if (!created.ok) throw new Error(created.error.code);
        let s = created.value.state;
        const rng = harnessRng(seedOf(i + 9));
        let actions = 0;
        while (s.status === 'in_progress' && actions <= bound) {
          // `stall` biases towards scoreless turns (0: normal play … 3: mostly stalling).
          const action =
            rng.int(0, 4) < stall ? scoreless(s, rng, 7) : chooseAction(s, rng, variant.ctx);
          const r = apply(s, action, variant.ctx);
          if (!r.ok) throw new Error(JSON.stringify(r.error));
          s = r.value.state;
          actions += 1;
        }
        expect(s.status).toBe('finished');
        expect(actions).toBeLessThanOrEqual(bound);
      }),
      { seed: 1404, numRuns: 12 },
    );
  }, 300_000);
});
