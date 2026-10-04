import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CTX,
  SMALL_PROFILE,
  SMALL_VERSION,
  config1v1,
  smallLexicon,
} from '../../test/support/small-lexicon.js';
import { deriveRng, deriveStreamState } from '../rng/index.js';
import { getLetterTable } from '../rules/constants.js';
import { chars, countTiles, initialBag, sortTiles } from '../tiles.js';
import type { MatchConfig, MatchSetup, MatchState } from '../types.js';
import { createMatch } from './create.js';

function create(config: MatchConfig = config1v1()): MatchState {
  const r = createMatch(config, CTX);
  if (!r.ok) throw new Error(`createMatch failed: ${r.error.code}`);
  return r.value.state;
}

function withSetup(setup: Partial<MatchSetup>): MatchConfig {
  const base = config1v1();
  return { ...base, config: { ...base.config, ...setup } };
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const seedArb = fc
  .array(fc.constantFrom(...'0123456789abcdef'.split('')), { minLength: 16, maxLength: 16 })
  .map((xs) => xs.join(''));

describe('createMatch — initial state (API note §7.2)', () => {
  it('builds the documented initial state', () => {
    const r = createMatch(config1v1(), CTX);
    if (!r.ok) throw new Error('expected ok');
    const { state, events } = r.value;
    expect(state.engineRulesVersion).toBe(1);
    expect(state.status).toBe('in_progress');
    expect(state.seatOnTurn).toBe(state.firstSeat);
    expect([state.turnNumber, state.scorelessTurns, state.actionCount]).toEqual([0, 0, 0]);
    expect(state.board).toEqual(new Array(15).fill('.'.repeat(15)));
    expect(state.seats).toHaveLength(2);
    for (const seat of state.seats) {
      expect(seat).toMatchObject({
        score: 0,
        chainK: 0,
        lastMainForm: '',
        bestTurnScore: 0,
        status: 'active',
      });
    }
    expect(state.result).toBeUndefined();
    expect(Object.keys(state).sort(byCodeUnit)).toEqual(
      [
        'actionCount',
        'bag',
        'board',
        'config',
        'definitionHash',
        'engineRulesVersion',
        'firstSeat',
        'lexiconVersion',
        'profileId',
        'rng',
        'scorelessTurns',
        'seatOnTurn',
        'seats',
        'seed',
        'status',
        'turnNumber',
      ].sort(byCodeUnit),
    );
    expect(events.map((e) => e.type)).toEqual([
      'MATCH_STARTED',
      'TILES_DRAWN',
      'TILES_DRAWN',
      'TURN_STARTED',
    ]);
    expect(events[0]).toEqual({ type: 'MATCH_STARTED', firstSeat: state.firstSeat, bagCount: 100 });
    expect(events[1]).toEqual({
      type: 'TILES_DRAWN',
      seat: 0,
      cause: 'deal',
      count: 7,
      tiles: state.seats[0]?.rack,
      bagCount: 93,
    });
    expect(events[3]).toEqual({ type: 'TURN_STARTED', seat: state.firstSeat, turnNumber: 0 });
  });

  it('P-BAG-005-a: seat 0 gets bag[0..6], seat 1 bag[7..13] of the shuffled bag; rng.bag is the stream after it', () => {
    const state = create();
    const rng = deriveRng('00c0de1e00000001', 'bag');
    const shuffled = rng.shuffle(chars(initialBag(getLetterTable('letters-v1')))).join('');
    expect(state.seats[0]?.rack).toBe(sortTiles(shuffled.slice(0, 7)));
    expect(state.seats[1]?.rack).toBe(sortTiles(shuffled.slice(7, 14)));
    expect(state.bag).toBe(shuffled.slice(14));
    expect(state.rng.bag).toEqual([...rng.state()]);
    expect(Array.isArray(state.rng.bag)).toBe(true);
  });

  it('GC-BAG-01 / P-BAG-004-a: racks 7 + 7, bag 86, multiset = initial bag', () => {
    const state = create();
    expect(state.bag).toHaveLength(86);
    const all = state.bag + state.seats.map((s) => s.rack).join('');
    expect(countTiles(all)).toEqual(countTiles(initialBag(getLetterTable('letters-v1'))));
  });

  it('P-CORE-001-c: same config ⇒ deep-equal state; inputs are not aliased', () => {
    const config = config1v1();
    const a = create(config);
    expect(create(config)).toEqual(a);
    expect(a.config).not.toBe(config.config);
    expect(a.config.teams[0]).not.toBe(config.config.teams[0]);
  });

  it('P-CORE-001-c: different seeds give different bag orders (no collision in 2,000 seeds)', () => {
    const bags = new Set<string>();
    for (let i = 0; i < 2000; i += 1) {
      bags.add(create(config1v1(i.toString(16).padStart(16, '0'))).bag);
    }
    expect(bags.size).toBe(2000);
  });

  it('P-BAG-001-d: the bag does not depend on the lexicon pin', () => {
    const other = smallLexicon('aaaaaaaaaaaaaaaa' as typeof SMALL_VERSION);
    const r = createMatch(config1v1(undefined, { lexiconVersion: other.version }), {
      lexicon: other,
    });
    if (!r.ok) throw new Error('expected ok');
    const base = create();
    expect(r.value.state.bag).toBe(base.bag);
    expect(r.value.state.seats).toEqual(base.seats);
  });

  it('P-CORE-004-a/c: firstSeat in range, a pure function of the seed, independent of the bag stream', () => {
    fc.assert(
      fc.property(seedArb, fc.constantFrom(2, 3, 4), (seed, seats) => {
        const teams = Array.from({ length: seats }, (_, i) => [i]);
        const config = config1v1(seed, {});
        const state = create({
          ...config,
          config: { ...config.config, format: 'untimed', seats, teams },
        });
        expect(state.firstSeat).toBe(deriveRng(seed, 'first-player').int(0, seats));
        expect(state.firstSeat).toBeGreaterThanOrEqual(0);
        expect(state.firstSeat).toBeLessThan(seats);
        expect(state.rng.bag).not.toEqual([...deriveStreamState(seed, 'first-player')]);
      }),
      { seed: 42, numRuns: 200 },
    );
  });

  it('P-CORE-004-b: each seat starts with frequency 1/n ± 2% over 10^4 seeds', () => {
    for (const seats of [2, 4]) {
      const counts = new Array<number>(seats).fill(0);
      for (let i = 0; i < 10_000; i += 1) {
        const seed = (i * 2654435761).toString(16).padStart(16, '0').slice(-16);
        const first = deriveRng(seed, 'first-player').int(0, seats);
        counts[first] = (counts[first] ?? 0) + 1;
      }
      for (const n of counts) expect(Math.abs(n / 10_000 - 1 / seats)).toBeLessThan(0.02);
    }
  });

  it('P-CORE-001-a / P-MODE-CLASSIC-001-a / P-MODE-CLASSIC-002-a: accepts every untimed format and team structure of API note §6', () => {
    const setups: Partial<MatchSetup>[] = [
      { format: 'untimed', seats: 2, teams: [[0], [1]] },
      { format: 'untimed', seats: 3, teams: [[0], [1], [2]] },
      { format: 'untimed', seats: 4, teams: [[0], [1], [2], [3]] },
      {
        format: 'untimed',
        seats: 4,
        teams: [
          [0, 2],
          [1, 3],
        ],
      },
      { requireWinner: 1 },
    ];
    for (const setup of setups) {
      const r = createMatch(withSetup(setup), CTX);
      expect(r.ok, JSON.stringify(setup)).toBe(true);
      if (r.ok) expect(r.value.state.seats).toHaveLength(r.value.state.config.seats);
    }
  });
});

describe('createMatch — failures (API note §13.1, P-CORE-001-a)', () => {
  const fail = (config: unknown): unknown => {
    const r = createMatch(config as MatchConfig, CTX);
    return r.ok ? undefined : r.error;
  };

  it('RULES_VERSION_UNSUPPORTED comes first', () => {
    // ADR-0014 §D6 details: { actual, supported: <frozen versions> } (+ status 'draft' for a refused draft).
    expect(fail({ ...config1v1(), engineRulesVersion: 3 as 1, seed: 'bad' })).toEqual({
      kind: 'engine',
      code: 'RULES_VERSION_UNSUPPORTED',
      message: 'unsupported engineRulesVersion',
      details: { actual: 3, supported: '1' },
    });
    expect(fail({ ...config1v1(), engineRulesVersion: 2, seed: 'bad' })).toMatchObject({
      kind: 'engine',
      code: 'RULES_VERSION_UNSUPPORTED',
      details: { actual: 2, supported: '1', status: 'draft' },
    });
    expect(fail(null)).toMatchObject({
      code: 'RULES_VERSION_UNSUPPORTED',
      details: { actual: 'undefined' },
    });
  });

  it.each([
    ['seed', { seed: '00C0DE1E00000001' }],
    ['seed', { seed: 7 }],
    ['lexiconVersion', { lexiconVersion: 'xyz' }],
    ['profileId', { profileId: '' }],
    ['profileId', { profileId: 'has space' }],
    ['definitionHash', { definitionHash: 'nothex0000000000' }],
    ['config', { config: [] }],
    ['extra', { extra: 1 }],
  ])('INVALID_CONFIG at %s', (field, patch) => {
    expect(fail({ ...config1v1(), ...patch })).toMatchObject({
      kind: 'engine',
      code: 'INVALID_CONFIG',
      details: { field },
    });
  });

  it('INVALID_CONFIG on a missing key', () => {
    const partial: Record<string, unknown> = { ...config1v1() };
    delete partial['profileId'];
    expect(fail(partial)).toMatchObject({
      code: 'INVALID_CONFIG',
      details: { field: 'profileId' },
    });
  });

  it.each([
    ['config.mode', { mode: 'blitz' }],
    ['config.format', { format: 'ranked' }],
    ['config.seats', { seats: 3, teams: [[0], [1], [2]] }], // untimed-vs-bot needs 2
    ['config.seats', { format: 'untimed', seats: 5 }],
    ['config.seats', { format: 'untimed', seats: 1 }],
    ['config.seats', { seats: 2.5 }],
    ['config.teams', { teams: [[1], [0]] }],
    ['config.teams', { teams: [[0, 1]] }],
    ['config.teams', { teams: 'x' }],
    ['config.teams', { teams: [0, 1] }],
    ['config.teams', { teams: [['0'], [1]] }],
    [
      'config.teams',
      {
        format: 'untimed',
        seats: 4,
        teams: [
          [0, 1],
          [2, 3],
        ],
      },
    ],
    ['config.layout', { layout: 'classic-v2' }],
    ['config.letters', { letters: 'letters-v0' }],
    ['config.requireWinner', { requireWinner: true }],
    ['config.extra', { extra: 0 }],
  ])('INVALID_CONFIG at %s', (field, patch) => {
    expect(fail(withSetup(patch as Partial<MatchSetup>))).toMatchObject({
      code: 'INVALID_CONFIG',
      details: { field },
    });
  });

  it('LEXICON_MISMATCH last, with expected/actual identities', () => {
    const lexicon = smallLexicon(
      SMALL_VERSION,
      '0000000000000000' as typeof SMALL_PROFILE.definitionHash,
    );
    const r = createMatch(config1v1(), { lexicon });
    expect(r.ok ? undefined : r.error).toEqual({
      kind: 'engine',
      code: 'LEXICON_MISMATCH',
      message: 'lexicon index does not match the match pin',
      details: {
        expected: `${SMALL_VERSION}/global-ranked/${SMALL_PROFILE.definitionHash}`,
        actual: `${SMALL_VERSION}/global-ranked/0000000000000000`,
      },
    });
    const wrongProfile = createMatch(config1v1(undefined, { profileId: 'season-s01' }), CTX);
    expect(wrongProfile.ok ? undefined : wrongProfile.error.code).toBe('LEXICON_MISMATCH');
    const wrongVersion = createMatch(
      config1v1(undefined, { lexiconVersion: 'bbbbbbbbbbbbbbbb' as typeof SMALL_VERSION }),
      CTX,
    );
    expect(wrongVersion.ok ? undefined : wrongVersion.error.code).toBe('LEXICON_MISMATCH');
  });
});
