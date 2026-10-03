/**
 * Q3 negative move harness. Three layers:
 *  1. each mutation class (legal move -> illegal move) is rejected by `apply` with the code §8.3 / GAME_RULES
 *     dictate, and the state is byte-identical afterwards (R-TURN-005, P-GLOBAL-03);
 *  2. the independent oracle (`oracle.ts`, no engine imports) agrees with `apply` (ok flag, code and details) on
 *     >= 10,000 generated moves, legal and mutated, from seeded mid-game states;
 *  3. rejection precedence (§8.3) on actions that violate several checks at once.
 *
 * Fixed fast-check seed. Default run is well under 30 s; `CODELEX_NEGATIVE_RUNS=200000` runs the big version.
 */
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { apply } from '../../src/match/apply.js';
import { serializeState } from '../../src/state/state.js';
import type { Action, MatchState } from '../../src/types.js';
import { NEGATIVE_CTX, NEGATIVE_LEXICON } from './lexicon.js';
import {
  badExchange,
  badOpening,
  disconnected,
  dropTile,
  foreignTile,
  offBoard,
  onOccupied,
  shiftByOne,
  swapLetter,
  useLexicon,
  wrongSeat,
  type Expectation,
  type Mutant,
  type MutationClass,
} from './mutators.js';
import { judge, SIZE, type OracleVerdict } from './oracle.js';
import { buildSnapshots, legalPool, type Snapshot } from './states.js';

// Pool generation is a brute-force enumeration; coverage instrumentation makes it several times slower.
vi.setConfig({ testTimeout: 120_000 });
const ENV = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
const SEED = 20261003;
const MATCHES = 24;
const RUNS = Number(ENV['CODELEX_NEGATIVE_RUNS'] ?? '12000');
const PER_CLASS_RUNS = 1500;
const has = (form: string): boolean => NEGATIVE_LEXICON.has(form);
useLexicon(has);

const snapshots: Snapshot[] = buildSnapshots(MATCHES);
const live = snapshots.filter((s) => s.state.status === 'in_progress');
const poolCache = new Map<number, Action[]>();
function pool(index: number): Action[] {
  let found = poolCache.get(index);
  if (found === undefined) {
    found = legalPool((live[index] as Snapshot).state, 10);
    poolCache.set(index, found);
  }
  return found;
}

// ---- comparison of the oracle's verdict with the engine's answer ---------------------------------------------

interface Actual {
  readonly ok: boolean;
  readonly code?: string;
  readonly violation?: string;
  readonly missing?: string;
  readonly words?: unknown;
}

function run(state: MatchState, action: unknown): Actual & { readonly next?: MatchState } {
  const r = apply(state, action as Action, NEGATIVE_CTX);
  if (r.ok) return { ok: true, next: r.value.state };
  const e = r.error;
  if (e.kind !== 'rejection') return { ok: false, code: `ENGINE:${e.code}` };
  const d = ('details' in e ? e.details : {}) as Record<string, unknown>;
  return {
    ok: false,
    code: e.code,
    ...(typeof d['violation'] === 'string' ? { violation: d['violation'] } : {}),
    ...(typeof d['missing'] === 'string' ? { missing: d['missing'] } : {}),
    ...(d['words'] !== undefined ? { words: d['words'] } : {}),
  };
}

function disagreement(
  snap: Snapshot,
  action: unknown,
  expected: unknown,
  actual: unknown,
  why: string,
): Error {
  const s = snap.state;
  return new Error(
    `${why}\n state ${snap.label}: seatOnTurn=${String(s.seatOnTurn)} racks=${JSON.stringify(
      s.seats.map((x) => [x.rack, x.status]),
    )} bag=${String(s.bag.length)}\n board=${JSON.stringify(s.board)}\n action=${JSON.stringify(
      action,
    )}\n expected=${JSON.stringify(expected)}\n actual=${JSON.stringify(actual)}`,
  );
}

const tally = {
  total: 0,
  legal: 0,
  codes: new Map<string, number>(),
  byClass: new Map<MutationClass | 'legal' | 'random', { n: number; rejected: number }>(),
};

function bump(klass: MutationClass | 'legal' | 'random', rejected: boolean): void {
  const cell = tally.byClass.get(klass) ?? { n: 0, rejected: 0 };
  cell.n += 1;
  if (rejected) cell.rejected += 1;
  tally.byClass.set(klass, cell);
}

/** Checks one action: oracle vs apply, optional hard expectation, and state immutability. */
function check(
  snap: Snapshot,
  action: unknown,
  klass: MutationClass | 'legal' | 'random',
  expectation?: Expectation,
): void {
  const state = snap.state;
  const before = serializeState(state);
  const verdict: OracleVerdict = judge(state, action, has);
  const actual = run(state, action);
  const after = serializeState(state);
  tally.total += 1;
  bump(klass, !actual.ok);
  if (!actual.ok)
    tally.codes.set(actual.code ?? '?', (tally.codes.get(actual.code ?? '?') ?? 0) + 1);
  else tally.legal += 1;

  if (after !== before) {
    throw disagreement(snap, action, 'state unchanged', 'state mutated', 'input state changed');
  }
  if (verdict.ok !== actual.ok) {
    throw disagreement(snap, action, verdict, actual, 'oracle and apply disagree on ok');
  }
  if (!verdict.ok) {
    const mismatch =
      verdict.code !== actual.code ||
      (verdict.violation !== undefined && verdict.violation !== actual.violation) ||
      (verdict.missing !== undefined && verdict.missing !== actual.missing) ||
      (verdict.words !== undefined &&
        JSON.stringify(verdict.words) !== JSON.stringify(actual.words));
    if (mismatch)
      throw disagreement(snap, action, verdict, actual, 'oracle and apply disagree on code');
  }
  if (expectation !== undefined) {
    const e = expectation;
    const wrong =
      actual.ok ||
      actual.code !== e.code ||
      (e.violation !== undefined && actual.violation !== e.violation) ||
      (e.missing !== undefined && actual.missing !== e.missing);
    if (wrong) throw disagreement(snap, action, e, actual, `${klass} mutant: wrong rejection`);
  }
}

// ---- generators ----------------------------------------------------------------------------------------------

type Maker = (snap: Snapshot, index: number, i: number, p: number) => Mutant | undefined;

const MAKERS: Record<MutationClass, Maker> = {
  shift: (_s, index, i, p) => shiftByOne(pickLegal(index, i), p),
  drop_tile: (_s, index, i, p) => dropTile(pickLegal(index, i), p),
  swap_main_word: (s, index, i, p) => swapLetter(s.state, pickLegal(index, i), p, 'main'),
  swap_cross_word: (s, index, i, p) => swapLetter(s.state, pickLegal(index, i), p, 'cross'),
  foreign_tile: (s, index, i, p) => foreignTile(s.state, pickLegal(index, i), p),
  wrong_seat: (s, index, i, p) => wrongSeat(s.state, pickLegal(index, i), p),
  bad_exchange: (s, _index, _i, p) => badExchange(s.state, p),
  occupied: (s, index, i, p) => onOccupied(s.state, pickLegal(index, i), p),
  off_board: (_s, index, i, p) => offBoard(pickLegal(index, i), p),
  start_not_covered: (s, index, i, p) => badOpening(s.state, pickLegal(index, i), p),
  first_move_too_short: (s, index, i, p) => badOpening(s.state, pickLegal(index, i), p * 5 + 4),
  not_connected: (s, index, i, p) => disconnected(s.state, pickLegal(index, i), p),
};
const CLASSES = Object.keys(MAKERS) as MutationClass[];

function pickLegal(index: number, i: number): Action {
  const found = pool(index);
  return found[i % Math.max(1, found.length)] ?? { seat: 0, type: 'PASS' };
}

/** Classes seen with an expectation fire at least this often over the per-class runs (not vacuous). */
const MIN_APPLICABLE = 40;
const applicable = new Map<MutationClass, number>();

const live0 = Math.max(0, live.length - 1);
const arbIndex = fc.integer({ min: 0, max: live0 });

/** Free-form action: random placement near the tiles, exchanges, passes, resigns, malformed shapes. */
const arbRaw = fc.record({
  kind: fc.integer({ min: 0, max: 9 }),
  seatPick: fc.integer({ min: 0, max: 5 }),
  anchor: fc.nat(),
  dr: fc.integer({ min: -3, max: 3 }),
  dc: fc.integer({ min: -3, max: 3 }),
  vertical: fc.boolean(),
  len: fc.integer({ min: 0, max: 8 }),
  picks: fc.array(
    fc.record({ k: fc.integer({ min: 0, max: 9 }), l: fc.integer({ min: 0, max: 25 }) }),
    {
      minLength: 8,
      maxLength: 8,
    },
  ),
});

function rawAction(state: MatchState, spec: RawSpec): unknown {
  const seats = state.config.seats;
  const seat = spec.seatPick < 4 ? state.seatOnTurn : (state.seatOnTurn + spec.seatPick) % seats;
  const rack = state.seats[state.seatOnTurn]?.rack ?? '';
  const tileFor = (n: number): string => {
    const pick = spec.picks[n % spec.picks.length] as { k: number; l: number };
    const letter = String.fromCharCode(65 + pick.l);
    const own = rack.charAt((pick.k + n) % Math.max(1, rack.length));
    if (pick.k < 7 && own !== '') return own === '?' ? letter.toLowerCase() : own;
    return pick.k === 8 ? letter.toLowerCase() : letter;
  };
  if (spec.kind === 0) return { seat, type: 'PASS' };
  if (spec.kind === 1) return { seat, type: 'RESIGN' };
  if (spec.kind === 2) {
    const tiles = Array.from({ length: spec.len }, (_, n) => {
      const t = tileFor(n);
      return t === t.toLowerCase() ? '?' : t;
    });
    return { seat, type: 'EXCHANGE', tiles };
  }
  if (spec.kind === 3) return { seat: seats + spec.dr, type: 'PASS' };
  // placement near an occupied square (or the centre of an empty board)
  const occupied: [number, number][] = [];
  state.board.forEach((row, r) => {
    for (let c = 0; c < row.length; c += 1) if (row.charAt(c) !== '.') occupied.push([r, c]);
  });
  const [ar, ac] =
    occupied.length === 0 ? [7, 7] : (occupied[spec.anchor % occupied.length] as [number, number]);
  const tiles = Array.from({ length: spec.len }, (_, n) => ({
    row: spec.vertical ? ar + spec.dr + n : ar + spec.dr,
    col: spec.vertical ? ac + spec.dc : ac + spec.dc + n,
    tile: tileFor(n),
  }));
  if (spec.kind === 4 && tiles.length > 1) {
    // break collinearity or add a duplicate square
    const second = tiles[1] as { row: number; col: number; tile: string };
    tiles[1] =
      spec.dc >= 0 ? { ...second, row: second.row + 1 } : { ...second, ...(tiles[0] as object) };
  }
  if (spec.kind === 5 && tiles.length > 0) {
    const first = tiles[0] as { row: number; col: number; tile: string };
    tiles[0] = { ...first, row: first.row + SIZE * spec.dr };
  }
  return { seat, type: 'PLACE_WORD', tiles };
}

interface RawSpec {
  readonly kind: number;
  readonly seatPick: number;
  readonly anchor: number;
  readonly dr: number;
  readonly dc: number;
  readonly vertical: boolean;
  readonly len: number;
  readonly picks: readonly { readonly k: number; readonly l: number }[];
}

// ---- tests ---------------------------------------------------------------------------------------------------

describe('negative harness: states and pools', () => {
  it('has mid-game, opening, low-bag, resigned and finished states', () => {
    const labels = snapshots.map((s) => s.label);
    expect(live.length).toBeGreaterThanOrEqual(60);
    expect(labels.some((l) => l.endsWith('lowbag'))).toBe(true);
    expect(labels.some((l) => l.endsWith('resigned'))).toBe(true);
    expect(snapshots.some((s) => s.state.status === 'finished')).toBe(true);
    expect(live.some((s) => s.state.board.every((row) => /^\.+$/.test(row)))).toBe(true);
    expect(live.some((s) => s.state.board.some((row) => /[A-Za-z]/.test(row)))).toBe(true);
  });

  it('the restrictive lexicon rejects most short strings', () => {
    const lex = NEGATIVE_LEXICON;
    expect(lex.has('QZ')).toBe(false);
    expect(lex.has('XYZ')).toBe(false);
    expect(lex.has('AI')).toBe(true);
    let twoLetter = 0;
    for (const a of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      for (const b of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (lex.has(a + b)) twoLetter += 1;
    }
    expect(twoLetter).toBeLessThan(60);
  });

  it('legal pools come from the oracle and apply accepts every one of them', () => {
    let total = 0;
    for (let i = 0; i < live.length; i += 1) {
      for (const action of pool(i)) {
        check(live[i] as Snapshot, action, 'legal');
        expect(run((live[i] as Snapshot).state, action).ok).toBe(true);
        total += 1;
      }
    }
    expect(total).toBeGreaterThan(200);
  });
});

describe('negative harness: each mutation class is rejected as the rules dictate', () => {
  for (const klass of CLASSES) {
    it(klass, () => {
      let count = 0;
      fc.assert(
        fc.property(arbIndex, fc.nat(), fc.nat(), (index, i, p) => {
          const snap = live[index] as Snapshot;
          const mutant = MAKERS[klass](snap, index, i, p);
          if (mutant === undefined) return;
          count += 1;
          check(snap, mutant.action, klass, mutant.expect);
        }),
        { seed: SEED, numRuns: PER_CLASS_RUNS, endOnFailure: false },
      );
      applicable.set(klass, count);
      // Not vacuous: the mutator must have produced mutants. (Opening-only classes need the empty-board states.)
      expect(count).toBeGreaterThanOrEqual(
        klass === 'first_move_too_short' || klass === 'start_not_covered' ? 5 : MIN_APPLICABLE,
      );
    });
  }

  it('shift-by-one mutants are mostly rejected and are never accepted unless the oracle accepts them', () => {
    const cell = tally.byClass.get('shift');
    expect(cell?.n ?? 0).toBeGreaterThan(MIN_APPLICABLE);
    expect((cell?.rejected ?? 0) / (cell?.n ?? 1)).toBeGreaterThan(0.5);
  });

  it('a rejection leaves the match state byte-identical, for every rejection code', () => {
    // `check` asserts serializeState(before) === serializeState(after) on every action of this file.
    for (const code of ['placement', 'rack', 'not_in_lexicon', 'not_your_turn', 'exchange']) {
      expect(tally.codes.get(code) ?? 0, code).toBeGreaterThan(0);
    }
  });
});

describe('negative harness: oracle agrees with apply', () => {
  it(`on >= 10,000 generated legal and mutated moves (runs: ${String(RUNS)})`, () => {
    const makers = CLASSES.map((klass) => MAKERS[klass]);
    const startTotal = tally.total;
    fc.assert(
      fc.property(
        arbIndex,
        fc.integer({ min: 0, max: makers.length + 2 }),
        fc.nat(),
        fc.nat(),
        arbRaw,
        (index, which, i, p, raw) => {
          const snap = live[index] as Snapshot;
          if (which >= makers.length + 1) {
            check(snap, rawAction(snap.state, raw), 'random');
            return;
          }
          if (which === makers.length) {
            check(snap, pickLegal(index, i), 'legal');
            return;
          }
          const mutant = (makers[which] as Maker)(snap, index, i, p);
          if (mutant === undefined) check(snap, pickLegal(index, i), 'legal');
          else check(snap, mutant.action, mutant.klass, mutant.expect);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
    const moves = tally.total - startTotal;
    console.info(
      `[Q3] oracle vs apply: ${String(moves)} moves; ` +
        `legal=${String(tally.legal)}; codes=${JSON.stringify([...tally.codes])}; ` +
        `classes=${JSON.stringify([...tally.byClass])}`,
    );
    expect(moves).toBeGreaterThanOrEqual(10_000);
    // Coverage of outcomes: the stream is not dominated by one kind of answer.
    for (const code of [
      'placement',
      'rack',
      'not_in_lexicon',
      'not_your_turn',
      'exchange',
      'malformed',
    ]) {
      expect(tally.codes.get(code) ?? 0, code).toBeGreaterThan(20);
    }
    expect(tally.legal).toBeGreaterThan(500);
  });

  it('match_over is returned for every action, RESIGN included, on finished states', () => {
    const finished = snapshots.filter((s) => s.state.status === 'finished');
    expect(finished.length).toBeGreaterThan(5);
    for (const snap of finished) {
      for (const type of ['PASS', 'RESIGN'] as const) {
        const action = { seat: snap.state.seatOnTurn, type };
        check(snap, action, 'random');
        expect(run(snap.state, action).code).toBe('match_over');
      }
      check(snap, { seat: 99, type: 'PASS' }, 'random');
      expect(run(snap.state, { seat: 99, type: 'PASS' }).code).toBe('match_over');
    }
  });

  it('a retired seat gets not_your_turn for every action, RESIGN included', () => {
    const resigned = snapshots.filter((s) => s.label.endsWith('resigned'));
    expect(resigned.length).toBeGreaterThan(0);
    for (const snap of resigned) {
      const retired = snap.state.seats.findIndex((s) => s.status !== 'active');
      for (const type of ['PASS', 'RESIGN'] as const) {
        const action = { seat: retired, type };
        check(snap, action, 'random');
        expect(run(snap.state, action).code).toBe('not_your_turn');
      }
    }
  });
});

describe('negative harness: rejection precedence (API-10, §8.3)', () => {
  const snap = live.find((s) => s.state.board.some((row) => /[A-Za-z]/.test(row))) as Snapshot;
  const state = snap.state;
  const seat = state.seatOnTurn;
  const other = (seat + 1) % state.config.seats;
  const absent = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ').find(
    (l) => !(state.seats[seat]?.rack ?? '').includes(l),
  ) as string;
  const occupiedSquare = ((): [number, number] => {
    for (let r = 0; r < SIZE; r += 1) {
      const c = state.board[r]?.search(/[A-Za-z]/) ?? -1;
      if (c >= 0) return [r, c];
    }
    return [7, 7];
  })();

  const cases: readonly (readonly [string, unknown, Expectation])[] = [
    [
      'not_your_turn beats off_board and rack',
      { seat: other, type: 'PLACE_WORD', tiles: [{ row: -1, col: 0, tile: absent }] },
      { code: 'not_your_turn' },
    ],
    [
      'malformed beats not_your_turn',
      { seat: other, type: 'PLACE_WORD', tiles: [{ row: 1.5, col: 0, tile: 'A' }] },
      { code: 'malformed', violation: 'bad_coordinate' },
    ],
    [
      'tile_count beats off_board',
      {
        seat,
        type: 'PLACE_WORD',
        tiles: Array.from({ length: 8 }, (_, i) => ({ row: -1, col: i, tile: 'A' })),
      },
      { code: 'placement', violation: 'tile_count' },
    ],
    [
      'off_board beats rack',
      { seat, type: 'PLACE_WORD', tiles: [{ row: SIZE, col: 0, tile: absent }] },
      { code: 'placement', violation: 'off_board' },
    ],
    [
      'duplicate_square beats rack',
      {
        seat,
        type: 'PLACE_WORD',
        tiles: [
          { row: 0, col: 0, tile: absent },
          { row: 0, col: 0, tile: absent },
        ],
      },
      { code: 'placement', violation: 'duplicate_square' },
    ],
    [
      'rack beats occupied',
      {
        seat,
        type: 'PLACE_WORD',
        tiles: [{ row: occupiedSquare[0], col: occupiedSquare[1], tile: absent }],
      },
      { code: 'rack', missing: absent },
    ],
    [
      'exchange tile_count beats bag_too_small and rack',
      { seat, type: 'EXCHANGE', tiles: [] },
      { code: 'exchange', violation: 'tile_count' },
    ],
  ];
  for (const [name, action, expectation] of cases) {
    it(name, () => {
      check(snap, action, 'random', expectation);
    });
  }

  it('exchange bag_too_small beats rack on a low bag', () => {
    const low = snapshots.find((s) => s.label.endsWith('lowbag')) as Snapshot;
    const l = Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ').find(
      (x) => !(low.state.seats[low.state.seatOnTurn]?.rack ?? '').includes(x),
    ) as string;
    check(low, { seat: low.state.seatOnTurn, type: 'EXCHANGE', tiles: [l] }, 'random', {
      code: 'exchange',
      violation: 'bag_too_small',
    });
  });

  it('gap beats not_connected, and occupied beats not_collinear', () => {
    const [r, c] = occupiedSquare;
    const rack = state.seats[seat]?.rack ?? '';
    const a = rack.charAt(0);
    const b = rack.charAt(1);
    if (a === '?' || b === '?' || a === '' || b === '') return;
    // two tiles far apart on one row, touching nothing: the hole is reported before the missing contact
    check(
      snap,
      {
        seat,
        type: 'PLACE_WORD',
        tiles: [
          { row: 0, col: 0, tile: a },
          { row: 0, col: 5, tile: b },
        ],
      },
      'random',
      { code: 'placement', violation: 'gap' },
    );
    // one tile on an occupied square and one off the line: occupied is reported before not_collinear
    check(
      snap,
      {
        seat,
        type: 'PLACE_WORD',
        tiles: [
          { row: r, col: c, tile: a },
          { row: (r + 3) % SIZE, col: (c + 2) % SIZE, tile: b },
        ],
      },
      'random',
      { code: 'placement', violation: 'occupied' },
    );
  });
});
