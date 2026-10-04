/**
 * Resume from a snapshot (API note §20 Q7): `replay(log, ctx, { from, verify })`. A snapshot is a cache, never
 * trusted on its own: it is used only if its hash equals the log's checkpoint at `from.actionCount`.
 * Properties, for v1 and the v2 draft:
 * - resuming from ANY snapshot of the match gives the same final state, hash and recorded hashes as a full replay;
 * - a tampered (or foreign) snapshot is detected: `HASH_MISMATCH` with `index: 'from'`.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { playSteps, seedOf, V1, type Played } from '../../test/support/play.js';
import { CTX } from '../../test/support/small-lexicon.js';
import { V2_248 } from '../../test/support/variants.js';
import { ALLOW_DRAFT_RULES } from '../draft.js';
import { parseState, serializeState, stateHash } from '../state/state.js';
import { chars, sortTiles } from '../tiles.js';
import type { MatchState, StateHash } from '../types.js';
import { newActionLog, replay, type ActionLog } from './log.js';

const OPTS = { draft: { optIn: ALLOW_DRAFT_RULES } };

function logOf(played: Played): ActionLog {
  return {
    ...newActionLog(played.config),
    actions: played.actions,
    stateHashes: played.states.slice(1).map(stateHash),
  };
}

/** The snapshot as the app stores it: `serializeState`, re-entered through `parseState` (draft opt-in for v2). */
function snapshot(s: MatchState): MatchState {
  const r = parseState(serializeState(s), OPTS);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value;
}

/** Changes that keep the snapshot a valid `MatchState` but make it a different one. */
function tamper(s: MatchState, kind: number): MatchState {
  const seats = s.seats;
  switch (kind % 4) {
    case 0:
      return { ...s, seats: seats.map((x, k) => (k === 0 ? { ...x, score: x.score + 1 } : x)) };
    case 1: {
      // Swap one rack tile with a different bag tile (tile conservation still holds).
      const seat = seats[s.seatOnTurn];
      const rack = seat?.rack ?? '';
      const t = rack.charAt(0);
      const at = chars(s.bag).findIndex((b) => b !== t);
      if (seat === undefined || rack === '' || at < 0) return tamper(s, kind + 1);
      const swapped = s.bag.charAt(at);
      return {
        ...s,
        bag: s.bag.slice(0, at) + t + s.bag.slice(at + 1),
        seats: seats.map((x, k) =>
          k === s.seatOnTurn ? { ...x, rack: sortTiles(swapped + rack.slice(1)) } : x,
        ),
      };
    }
    case 2:
      return { ...s, rng: { bag: [s.rng.bag[0] ^ 1, s.rng.bag[1], s.rng.bag[2], s.rng.bag[3]] } };
    default:
      return { ...s, scorelessTurns: s.scorelessTurns + 1 };
  }
}

const VARIANTS = [
  ['v1', V1],
  ['v2-248', V2_248],
] as const;

const played = fc
  .tuple(fc.nat(5000), fc.constantFrom(2, 3, 4), fc.integer({ min: 1, max: 60 }))
  .map(([i, seats, steps]) => ({ i, seats, steps }));

describe.each(VARIANTS)(
  'replay from a snapshot (API note §20 Q7; P-API-07) — %s',
  (_id, variant) => {
    it('resuming from any snapshot gives the same final state and hash as a full replay', () => {
      fc.assert(
        fc.property(played, fc.nat(1000), fc.boolean(), ({ i, seats, steps }, pick, fast) => {
          const game = playSteps(seedOf(i), seats, steps, variant);
          const log = logOf(game);
          const full = replay(log, variant.ctx, { recordHashes: true });
          if (!full.ok) throw new Error(JSON.stringify(full.error));
          const k = pick % game.states.length;
          const from = snapshot(game.states[k] as MatchState);
          const verify = fast ? 'final' : 'all';
          const resumed = replay(log, variant.ctx, { from, verify, recordHashes: true });
          expect(resumed).toEqual(full);
          expect(replay(log, variant.ctx, { from, verify })).toEqual({
            ok: true,
            value: { state: full.value.state, finalHash: full.value.finalHash },
          });
        }),
        { seed: 1501, numRuns: 40 },
      );
    }, 120_000);

    it('a tampered or foreign snapshot is detected (HASH_MISMATCH at from), whatever the verify mode', () => {
      fc.assert(
        fc.property(played, fc.nat(1000), fc.nat(3), ({ i, seats, steps }, pick, kind) => {
          const game = playSteps(seedOf(i), seats, steps, variant);
          const log = logOf(game);
          const k = pick % game.states.length;
          const original = game.states[k] as MatchState;
          const bad = tamper(original, kind);
          expect(stateHash(bad)).not.toBe(stateHash(original));
          for (const verify of ['all', 'final'] as const) {
            expect(replay(log, variant.ctx, { from: bad, verify })).toEqual({
              ok: false,
              error: {
                kind: 'replay',
                code: 'HASH_MISMATCH',
                message: 'state hash mismatch at from',
                details: { index: 'from', expected: stateHash(original), actual: stateHash(bad) },
              },
            });
          }
          // A snapshot of another match at the same action count is foreign to this log.
          const other = playSteps(seedOf(i + 1), seats, k, variant).states.at(-1) as MatchState;
          if (other.actionCount === k) {
            expect(replay(log, variant.ctx, { from: other })).toMatchObject({
              ok: false,
              error: { code: 'HASH_MISMATCH', details: { index: 'from' } },
            });
          }
        }),
        { seed: 1502, numRuns: 40 },
      );
    }, 120_000);
  },
);

describe('replay options (API note §20 Q7)', () => {
  const game = playSteps(seedOf(42), 2, 12);
  const log = logOf(game);
  const hashes = log.stateHashes ?? [];
  const last = hashes.length - 1;

  it("verify 'final' skips the middle checkpoints but still checks the last one and final", () => {
    const corruptMiddle = hashes.map((h, k) => (k === 1 ? ('0'.repeat(16) as StateHash) : h));
    expect(replay({ ...log, stateHashes: corruptMiddle }, V1.ctx, { verify: 'final' }).ok).toBe(
      true,
    );
    expect(replay({ ...log, stateHashes: corruptMiddle }, V1.ctx)).toMatchObject({
      error: { code: 'HASH_MISMATCH', details: { index: 1 } },
    });
    const corruptLast = hashes.map((h, k) => (k === last ? ('0'.repeat(16) as StateHash) : h));
    expect(replay({ ...log, stateHashes: corruptLast }, V1.ctx, { verify: 'final' })).toMatchObject(
      { error: { code: 'HASH_MISMATCH', details: { index: last } } },
    );
  });

  it('from.actionCount outside the log, or a checkpoint the log does not carry, is MALFORMED_LOG', () => {
    const end = game.states.at(-1) as MatchState;
    const short = { ...log, actions: log.actions.slice(0, 2), stateHashes: hashes.slice(0, 2) };
    expect(replay(short, V1.ctx, { from: end })).toMatchObject({
      error: { code: 'MALFORMED_LOG', details: { path: 'from.actionCount' } },
    });
    const bare: ActionLog = { logVersion: 1, header: log.header, actions: log.actions };
    expect(replay(bare, V1.ctx, { from: end })).toMatchObject({
      error: { code: 'MALFORMED_LOG', details: { path: 'stateHashes' } },
    });
    // The initial state needs no stored checkpoint: it is checked against createMatch(header).
    const initial = game.states[0] as MatchState;
    const fromStart = replay(bare, V1.ctx, { from: initial });
    expect(fromStart.ok && fromStart.value.finalHash).toBe(stateHash(end));
  });

  it('the rules version and lexicon are checked before the snapshot', () => {
    const end = game.states.at(-1) as MatchState;
    expect(replay(log, CTX, { from: end })).toMatchObject({ error: { code: 'LEXICON_MISMATCH' } });
    const draftLog = logOf(playSteps(seedOf(7), 2, 3, V2_248));
    expect(replay(draftLog, V1.ctx, { from: end })).toMatchObject({
      error: { code: 'RULES_VERSION_UNSUPPORTED', details: { status: 'draft' } },
    });
  });
});
