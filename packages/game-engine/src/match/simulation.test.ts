/**
 * Full-match properties (sprint E4 exit criterion): ≥ 1,000 seeded matches of random-legal play, each one
 * replayed from its action log to the same hashes, with 0 conservation violations, P-GLOBAL-01…08 and
 * P-API-01/05/06/07 checked along the way.
 */
import { describe, expect, it } from 'vitest';
import { chooseAction, harnessRng, simConfig, SIM_CTX } from '../../test/support/play.js';
import {
  parseActionLog,
  replay,
  serializeActionLog,
  newActionLog,
  type ActionLog,
} from '../replay/log.js';
import { getLetterTable } from '../rules/constants.js';
import { parseState, serializeState, stateHash } from '../state/state.js';
import { countTiles, initialBag, isBlankOnBoard } from '../tiles.js';
import type { Action, MatchState } from '../types.js';
import { apply } from './apply.js';
import { createMatch } from './create.js';
import { evaluateMove, observe } from './observe.js';

const MATCHES = 1000;
const INITIAL = countTiles(initialBag(getLetterTable('letters-v1')));

function conserved(state: MatchState): boolean {
  let all = state.bag + state.seats.map((s) => s.rack).join('');
  for (const row of state.board) {
    for (let c = 0; c < row.length; c += 1) {
      const t = row.charAt(c);
      if (t !== '.') all += isBlankOnBoard(t) ? '?' : t;
    }
  }
  const counts = countTiles(all);
  return INITIAL.every((n, i) => counts[i] === n);
}

function seedOf(i: number): string {
  return (i * 0x9e3779b1 + 12345).toString(16).padStart(16, '0').slice(-16);
}

interface Played {
  readonly state: MatchState;
  readonly log: ActionLog;
  readonly placed: number;
}

function play(seed: string, seats: number): Played {
  const config = simConfig(seed, seats);
  const created = createMatch(config, SIM_CTX);
  if (!created.ok) throw new Error(created.error.code);
  let state = created.value.state;
  const rng = harnessRng(seed);
  const actions: Action[] = [];
  let placed = 0;
  for (let guard = 0; state.status === 'in_progress'; guard += 1) {
    if (guard > 500) throw new Error(`match ${seed} did not end`);
    const action = chooseAction(state, rng);
    // P-GLOBAL-01 / P-GLOBAL-03 are checked on a sample of actions (serialisation is the costly part).
    const sampled = guard % 5 === 0;
    const before = sampled ? serializeState(state) : '';

    // P-GLOBAL-03 / R-TURN-005: a rejected attempt is invisible (sampled: an out-of-turn PASS).
    if (sampled) {
      const other = (state.seatOnTurn + 1) % seats;
      const rejected = apply(state, { seat: other, type: 'PASS' }, SIM_CTX);
      expect(rejected.ok).toBe(false);
      expect(serializeState(state)).toBe(before);
    }

    const evaluation =
      action.type === 'PLACE_WORD'
        ? evaluateMove(observe(state, action.seat), action, SIM_CTX)
        : undefined;
    const r = apply(state, action, SIM_CTX);
    if (!r.ok) throw new Error(`${seed}: legal action rejected: ${JSON.stringify(r.error)}`);
    // P-GLOBAL-01: the input state is never mutated.
    if (sampled) expect(serializeState(state)).toBe(before);
    const next = r.value.state;
    expect(next.actionCount).toBe(state.actionCount + 1);
    expect(conserved(next)).toBe(true);

    if (action.type === 'PLACE_WORD') {
      placed += 1;
      const placedEvent = r.value.events.find((e) => e.type === 'WORD_PLACED');
      if (placedEvent?.type !== 'WORD_PLACED' || evaluation === undefined || !evaluation.ok) {
        throw new Error('expected WORD_PLACED and a successful evaluation');
      }
      // P-API-01: evaluateMove ≡ apply; P-API-05: the score delta is the breakdown total.
      expect(evaluation.value.breakdown).toEqual(placedEvent.breakdown);
      const b = placedEvent.breakdown;
      expect(b.total).toBe(b.words.reduce((s, w) => s + w.total, 0) + b.fullStack + b.chain);
      expect(Number.isSafeInteger(b.total) && b.total >= 0).toBe(true);
      const mover = state.seats[action.seat];
      const after = next.seats[action.seat];
      if (next.status === 'in_progress') expect(after?.score).toBe((mover?.score ?? 0) + b.total);
      expect(next.scorelessTurns).toBe(0);
    }
    if (next.status === 'in_progress') {
      // P-GLOBAL-06: running scores stay non-negative integers until end-of-match adjustments.
      expect(next.seats.every((s) => Number.isSafeInteger(s.score) && s.score >= 0)).toBe(true);
    }
    actions.push(r.value.action);
    state = next;
  }

  // P-GLOBAL-08: terminal states are absorbing.
  const after = apply(state, { seat: state.seatOnTurn, type: 'PASS' }, SIM_CTX);
  expect(after.ok ? undefined : after.error.code).toBe('match_over');

  return { state, log: { ...newActionLog(config), actions }, placed };
}

describe(`full matches (${String(MATCHES)} seeds; P-GLOBAL-01…08, P-API-01/05/06/07)`, () => {
  it(
    'every match ends, conserves tiles and replays to identical hashes',
    { timeout: 300_000 },
    () => {
      const reasons = new Map<string, number>();
      let placed = 0;
      for (let i = 0; i < MATCHES; i += 1) {
        const seed = seedOf(i);
        const seats = i % 10 === 9 ? 3 + (i % 20 === 19 ? 1 : 0) : 2;
        const played = play(seed, seats);
        placed += played.placed;
        const end = played.state.result?.end.reason ?? 'none';
        reasons.set(end, (reasons.get(end) ?? 0) + 1);

        // P-API-07 / P-GLOBAL-02: replay reaches the same state and hash; recorded hashes verify.
        const recorded = replay(played.log, SIM_CTX, { recordHashes: true });
        if (!recorded.ok) throw new Error(`${seed}: ${JSON.stringify(recorded.error)}`);
        expect(recorded.value.state).toEqual(played.state);
        expect(recorded.value.finalHash).toBe(stateHash(played.state));
        const full: ActionLog = {
          ...played.log,
          stateHashes: recorded.value.stateHashes ?? [],
          final: { stateHash: recorded.value.finalHash, actionCount: played.log.actions.length },
        };
        // P-API-06: log round trip; P-GLOBAL-04: state round trip.
        const parsed = parseActionLog(serializeActionLog(full));
        if (!parsed.ok) throw new Error(`${seed}: ${JSON.stringify(parsed.error)}`);
        expect(parsed.value).toEqual(full);
        if (i % 50 === 0) {
          expect(replay(parsed.value, SIM_CTX).ok).toBe(true);
          const state = parseState(serializeState(played.state));
          expect(state.ok && state.value).toEqual(played.state);
        }
      }
      // The generator exercises every end reason and plenty of words.
      expect(reasons.get('going_out') ?? 0).toBeGreaterThan(0);
      expect(reasons.get('scoreless_turns') ?? 0).toBeGreaterThan(0);
      expect(reasons.get('resign') ?? 0).toBeGreaterThan(0);
      expect(placed).toBeGreaterThan(MATCHES * 5);
    },
  );
});
