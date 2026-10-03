/**
 * API-level properties on generated mid-game states (API note §18; review R1 m3):
 * - P-API-01 in both directions with ARBITRARY actions (random seat; tiles off-board, on occupied squares or
 *   missing from the rack; non-words; EXCHANGE of every count): `evaluateMove(observe(s, p), a)` and `apply(s, a)`
 *   agree on acceptance, on the full rejection, and on the breakdown;
 * - P-GLOBAL-03 deep: `apply` never changes `serializeState(s)`, accepted or rejected;
 * - P-API-02: `previewScore` is non-null exactly when geometry and rack pass;
 * - P-API-03: `observe` is invariant under hidden-information changes;
 * - P-API-04: `eventsFor` never leaks another seat's drawn or returned tiles.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  harnessRng,
  isUnplayableShort,
  legalMoves,
  playSteps,
  seedOf,
  SIM_CTX,
} from '../../test/support/play.js';
import { createRng, type Rng } from '../rng/index.js';
import { serializeState } from '../state/state.js';
import { chars, LETTERS } from '../tiles.js';
import type {
  Action,
  BoardTile,
  MatchEvent,
  MatchState,
  Placement,
  RackTile,
  Viewer,
} from '../types.js';
import { apply } from './apply.js';
import { createMatch } from './create.js';
import { eventsFor, evaluateMove, observe, previewScore } from './observe.js';

const pick = <T>(rng: Rng, items: readonly T[]): T => items[rng.int(0, items.length)] as T;

const letter = (rng: Rng): string => LETTERS.charAt(rng.int(0, 26));

/** A random tile for a placement: often from the rack, sometimes any letter or a designated blank. */
function randomTile(rng: Rng, rack: string): BoardTile {
  const roll = rng.int(0, 4);
  if (roll < 2 && rack.length > 0) {
    const t = rack.charAt(rng.int(0, rack.length));
    return (t === '?' ? letter(rng).toLowerCase() : t) as BoardTile;
  }
  return (roll === 2 ? letter(rng) : letter(rng).toLowerCase()) as BoardTile;
}

/** Squares next to occupied ones (anchors), the start square on an empty board. */
function anchorSquares(board: readonly string[]): [number, number][] {
  const occupied = (r: number, c: number): boolean => (board[r]?.charAt(c) ?? '.') !== '.';
  const out: [number, number][] = [];
  for (let r = 0; r < 15; r += 1) {
    for (let c = 0; c < 15; c += 1) {
      if (
        !occupied(r, c) &&
        (occupied(r - 1, c) || occupied(r + 1, c) || occupied(r, c - 1) || occupied(r, c + 1))
      ) {
        out.push([r, c]);
      }
    }
  }
  return out.length > 0 ? out : [[7, 7]];
}

/** Arbitrary actions for `s`: legal moves, their mutations and random noise of every action type. */
function arbitraryActions(s: MatchState, rng: Rng): Action[] {
  const n = s.config.seats;
  const seatOf = (): number => (rng.int(0, 3) === 0 ? rng.int(0, n) : s.seatOnTurn);
  const rack = (seat: number): string => s.seats[seat]?.rack ?? '';
  const actions: Action[] = [];
  const legal = s.status === 'in_progress' ? legalMoves(s, rng, 3) : [];
  for (const move of legal) {
    actions.push(move.action);
    const tiles = move.action.tiles;
    const i = rng.int(0, tiles.length);
    const at = tiles[i] as Placement;
    // Same squares, one tile swapped for a random letter: often a non-word (main or cross-word).
    actions.push({
      ...move.action,
      tiles: tiles.map((t, k) => (k === i ? { ...t, tile: letter(rng) as BoardTile } : t)),
    });
    // Shifted by one square: occupied squares, gaps, lost contact or new cross-words.
    const [dr, dc] = pick(rng, [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ] as const);
    actions.push({
      ...move.action,
      tiles: tiles.map((t) => ({ ...t, row: t.row + dr, col: t.col + dc })),
    });
    // Off the board.
    actions.push({ ...move.action, tiles: [...tiles, { ...at, row: 15 }] });
    // Another seat sends the same legal move.
    actions.push({ ...move.action, seat: (move.action.seat + 1 + rng.int(0, n - 1)) % n });
  }
  const anchors = anchorSquares(s.board);
  for (let k = 0; k < 6; k += 1) {
    const seat = seatOf();
    const count = rng.int(0, 9);
    const [r0, c0] = pick(rng, anchors);
    const vertical = rng.int(0, 2) === 0;
    const tiles: Placement[] = [];
    for (let j = 0; j < count; j += 1) {
      const jitter = rng.int(0, 8) === 0 ? rng.int(-3, 4) : 0;
      tiles.push({
        row: vertical ? r0 + j : r0 + jitter,
        col: vertical ? c0 + jitter : c0 + j,
        tile: randomTile(rng, rack(seat)),
      });
    }
    actions.push({ seat, type: 'PLACE_WORD', tiles });
  }
  // A single tile on an anchor: its cross-words are 2- and 3-letter strings, some of them unplayable.
  for (let k = 0; k < 4; k += 1) {
    const [row, col] = pick(rng, anchors);
    actions.push({
      seat: s.seatOnTurn,
      type: 'PLACE_WORD',
      tiles: [{ row, col, tile: randomTile(rng, rack(s.seatOnTurn)) }],
    });
  }
  // EXCHANGE of every count 0..8, from the rack or not.
  for (let count = 0; count <= 8; count += 1) {
    const seat = seatOf();
    const own = rng.shuffle(chars(rack(seat)));
    const tiles: RackTile[] = [];
    for (let j = 0; j < count; j += 1) {
      tiles.push((rng.int(0, 4) === 0 || j >= own.length ? letter(rng) : own[j]) as RackTile);
    }
    actions.push({ seat, type: 'EXCHANGE', tiles });
  }
  actions.push({ seat: seatOf(), type: 'PASS' });
  actions.push({ seat: seatOf(), type: 'RESIGN' });
  return actions;
}

const seen = new Map<string, number>();
const note = (key: string): void => {
  seen.set(key, (seen.get(key) ?? 0) + 1);
};

/** A generated state: random seed, seat count and number of steps (finished states included). */
const generatedState = fc
  .tuple(fc.nat(5000), fc.constantFrom(2, 2, 3, 4), fc.nat(90))
  .map(([i, seats, steps]) => ({ i, played: playSteps(seedOf(i), seats, steps) }));

describe('P-API-01 / P-API-02 / P-GLOBAL-03 with arbitrary actions (review R1 m3)', () => {
  it('evaluateMove ≡ apply in both directions; apply never changes the serialised state', () => {
    fc.assert(
      fc.property(generatedState, ({ i, played }) => {
        const s = played.states.at(-1) as MatchState;
        const before = serializeState(s);
        const rng = harnessRng(seedOf(i + 7));
        for (const action of arbitraryActions(s, rng)) {
          const applied = apply(s, action, SIM_CTX);
          // P-GLOBAL-03 deep (and P-GLOBAL-01 for accepted actions).
          expect(serializeState(s)).toBe(before);
          note(applied.ok ? `${action.type}:ok` : `${action.type}:${applied.error.code}`);
          if (!applied.ok && applied.error.code === 'not_in_lexicon') {
            const words = applied.error.details.words;
            if (words.some((w) => !w.main)) note('not_in_lexicon:cross');
            if (words.some((w) => !w.main && isUnplayableShort(w.form))) note('cross:short');
          }
          if (action.type !== 'PLACE_WORD') continue;
          const seat = s.seats[action.seat];
          if (seat === undefined) continue;
          // evaluateMove has no turn check: compare with apply on the same state, that seat on turn.
          const target =
            action.seat === s.seatOnTurn || s.status === 'finished' || seat.status !== 'active'
              ? s
              : { ...s, seatOnTurn: action.seat };
          const reference = target === s ? applied : apply(target, action, SIM_CTX);
          const evaluated = evaluateMove(observe(s, action.seat), action, SIM_CTX);
          expect(evaluated.ok).toBe(reference.ok);
          if (!evaluated.ok && !reference.ok) {
            // A resigned seat gets not_your_turn from both, with the seat on turn of the observation.
            expect(evaluated.error).toEqual(reference.error);
          }
          if (evaluated.ok && reference.ok) {
            const placed = reference.value.events.find((e) => e.type === 'WORD_PLACED');
            expect(placed?.type === 'WORD_PLACED' && placed.breakdown).toEqual(
              evaluated.value.breakdown,
            );
            expect(evaluated.value.action).toEqual(reference.value.action);
          }
          // P-API-02: a preview exists iff geometry and rack pass (lexicon never consulted).
          const preview = previewScore(observe(s, action.seat), action.tiles);
          const code = reference.ok ? 'ok' : reference.error.code;
          const geometric = code === 'ok' || code === 'not_in_lexicon';
          expect(preview !== null).toBe(geometric);
          if (preview !== null && evaluated.ok) {
            const b = evaluated.value.breakdown;
            expect(preview.total).toBe(b.words.reduce((t, w) => t + w.base, 0) + b.fullStack);
          }
        }
      }),
      { seed: 1003, numRuns: 150 },
    );
    // The generator reaches every outcome that matters.
    for (const key of [
      'PLACE_WORD:ok',
      'PLACE_WORD:placement',
      'PLACE_WORD:rack',
      'PLACE_WORD:not_in_lexicon',
      'not_in_lexicon:cross',
      'cross:short',
      'PLACE_WORD:not_your_turn',
      'PLACE_WORD:match_over',
      'EXCHANGE:ok',
      'EXCHANGE:exchange',
      'EXCHANGE:rack',
      'PASS:ok',
      'RESIGN:ok',
    ]) {
      expect(seen.get(key) ?? 0, key).toBeGreaterThan(0);
    }
  }, 120_000);
});

/** `s` with every hidden field changed: seed, rng, bag order and the contents of the other racks (same counts). */
function withHiddenChanged(s: MatchState, viewer: Viewer, rng: Rng): MatchState {
  const others = s.seats.flatMap((_, i) => (viewer === i || s.status === 'finished' ? [] : [i]));
  const pool = rng.shuffle(chars(s.bag + others.map((i) => s.seats[i]?.rack ?? '').join('')));
  let at = 0;
  const take = (n: number): string => {
    const part = pool.slice(at, at + n);
    at += n;
    return part.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join('');
  };
  const seats = s.seats.map((seat, i) =>
    others.includes(i) ? { ...seat, rack: take(seat.rack.length) } : seat,
  );
  return {
    ...s,
    seed: 'fedcba9876543210' as MatchState['seed'],
    rng: { bag: [rng.next() | 1, rng.next(), rng.next(), rng.next()] },
    bag: pool.slice(at).join(''),
    seats,
  };
}

const OBSERVATION_KEYS = [
  'actionCount',
  'bagCount',
  'board',
  'config',
  'definitionHash',
  'engineRulesVersion',
  'firstSeat',
  'lexiconVersion',
  'profileId',
  'rack',
  'scorelessTurns',
  'seatOnTurn',
  'seats',
  'status',
  'teamScores',
  'turnNumber',
  'unseen',
  'viewer',
];

describe('P-API-03: observe is invariant under hidden-information changes (PBT)', () => {
  it(
    'same observation for every viewer; no seed, rng, bag or other rack in it',
    { timeout: 120_000 },
    () => {
      fc.assert(
        fc.property(generatedState, fc.nat(4), ({ i, played }, v) => {
          const s = played.states.at(-1) as MatchState;
          const viewer: Viewer = v >= s.config.seats ? 'spectator' : v;
          const other = withHiddenChanged(s, viewer, harnessRng(seedOf(i + 11)));
          const o = observe(s, viewer);
          expect(observe(other, viewer)).toEqual(o);
          const finished = s.status === 'finished' ? ['finalRacks', 'result'] : [];
          const sorted = (keys: string[]): string[] =>
            keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
          expect(sorted(Object.keys(o))).toEqual(sorted([...OBSERVATION_KEYS, ...finished]));
          expect(o.rack).toBe(viewer === 'spectator' ? '' : s.seats[viewer]?.rack);
          for (const view of o.seats) {
            expect(Object.keys(view)).not.toContain('rack');
            expect(view.rackCount).toBe(s.seats[view.seat]?.rack.length);
          }
          const unseenTotal = o.unseen.reduce((a, b) => a + b, 0);
          const hidden =
            s.bag.length + s.seats.reduce((t, x, k) => t + (k === viewer ? 0 : x.rack.length), 0);
          expect(unseenTotal).toBe(hidden);
        }),
        { seed: 1004, numRuns: 120 },
      );
    },
  );
});

/** Every event seat field of `events` that carries private tiles. */
function privateTiles(event: MatchEvent): { seat: number; tiles: string | undefined } | undefined {
  if (event.type === 'TILES_DRAWN') return { seat: event.seat, tiles: event.tiles };
  if (event.type === 'TILES_EXCHANGED') return { seat: event.seat, tiles: event.returned };
  return undefined;
}

function checkRedaction(events: readonly MatchEvent[], seats: number): void {
  const viewers: Viewer[] = [...Array.from({ length: seats }, (_, k) => k), 'spectator'];
  for (const viewer of viewers) {
    const view = eventsFor(events, viewer);
    expect(view).toHaveLength(events.length);
    view.forEach((event, k) => {
      const original = events[k] as MatchEvent;
      expect(event.type).toBe(original.type);
      const priv = privateTiles(event);
      if (priv === undefined) {
        expect(event).toBe(original);
        return;
      }
      if (priv.seat === viewer) expect(event).toEqual(original);
      else {
        expect(priv.tiles).toBeUndefined();
        expect(Object.keys(event)).not.toContain(
          event.type === 'TILES_DRAWN' ? 'tiles' : 'returned',
        );
      }
    });
  }
}

describe('P-API-04: eventsFor never leaks another seat’s tiles (PBT)', () => {
  it(
    'for creation events and for the events of every accepted action',
    { timeout: 120_000 },
    () => {
      fc.assert(
        fc.property(generatedState, ({ i, played }) => {
          const created = createMatch(played.config, SIM_CTX);
          if (!created.ok) throw new Error(created.error.code);
          checkRedaction(created.value.events, played.config.config.seats);
          const rng = createRng(harnessRng(seedOf(i + 13)).state());
          played.actions.forEach((action, k) => {
            if (rng.int(0, 3) !== 0) return; // a third of the actions, for time
            const r = apply(played.states[k] as MatchState, action, SIM_CTX);
            if (!r.ok) throw new Error('replayed action rejected');
            checkRedaction(r.value.events, played.config.config.seats);
          });
          // Exchanges are rare in play: also check every arbitrary exchange of the final state.
          const s = played.states.at(-1) as MatchState;
          for (const action of arbitraryActions(s, rng)) {
            if (action.type !== 'EXCHANGE') continue;
            const r = apply(s, action, SIM_CTX);
            if (r.ok) checkRedaction(r.value.events, played.config.config.seats);
          }
        }),
        { seed: 1005, numRuns: 80 },
      );
    },
  );
});
