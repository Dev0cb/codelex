import { describe, expect, it } from 'vitest';
import {
  CTX,
  config1v1,
  smallLexicon,
  type SMALL_VERSION,
} from '../../test/support/small-lexicon.js';
import { createMatch } from '../match/create.js';
import type { MatchState, SeatState } from '../types.js';
import { validateAction } from './validate.js';

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

const created = createMatch(config1v1(), CTX);
if (!created.ok) throw new Error('fixture');
const BASE = created.value.state;

/** A state with chosen racks, bag and seat on turn; frozen so any mutation throws (P-GLOBAL-01). */
function state(overrides: Partial<MatchState> = {}, seats?: Partial<SeatState>[]): MatchState {
  const s: MatchState = {
    ...BASE,
    seatOnTurn: 0,
    seats: BASE.seats.map((seat, i) => ({ ...seat, ...(seats?.[i] ?? {}) })),
    ...overrides,
  };
  return deepFreeze(s);
}

const code = (s: MatchState, action: unknown, ctx = CTX): unknown => {
  const r = validateAction(s, action, ctx);
  return r.ok ? r.value.type : r.error.code;
};

const placeAI = {
  seat: 0,
  type: 'PLACE_WORD',
  tiles: [
    { row: 7, col: 7, tile: 'A' },
    { row: 7, col: 8, tile: 'I' },
  ],
};

describe('validateAction — precedence (API note §8.3, P-API-08)', () => {
  it('1. RULES_VERSION_UNSUPPORTED before LEXICON_MISMATCH before anything else', () => {
    const foreign = { lexicon: smallLexicon('cccccccccccccccc' as typeof SMALL_VERSION) };
    const old = state({ engineRulesVersion: 2 as 1, status: 'finished' });
    expect(code(old, 'garbage', foreign)).toBe('RULES_VERSION_UNSUPPORTED');
    expect(code(state({ status: 'finished' }), 'garbage', foreign)).toBe('LEXICON_MISMATCH');
  });

  it('2. match_over for every action once finished, RESIGN included (P-GLOBAL-08)', () => {
    const over = state({ status: 'finished' });
    expect(code(over, 'garbage')).toBe('match_over');
    expect(code(over, { seat: 1, type: 'RESIGN' })).toBe('match_over');
  });

  it('3. malformed before not_your_turn', () => {
    expect(code(state(), { seat: 1, type: 'PASS', extra: 1 })).toBe('malformed');
    expect(code(state(), { seat: 2, type: 'PASS' })).toBe('malformed');
  });

  it('4. GC-TURN-01: out-of-turn Pass → not_your_turn; out-of-turn Resign → accepted', () => {
    const r = validateAction(state(), { seat: 1, type: 'PASS' }, CTX);
    expect(r).toEqual({
      ok: false,
      error: {
        kind: 'rejection',
        code: 'not_your_turn',
        message: "not this seat's turn",
        details: { seatOnTurn: 0, seatInactive: false },
      },
    });
    expect(code(state(), { seat: 1, type: 'RESIGN' })).toBe('RESIGN');
  });

  it('4. a resigned seat gets not_your_turn (seatInactive) for every action, RESIGN included', () => {
    const s = state({}, [{}, { status: 'resigned' }]);
    for (const action of [
      { seat: 1, type: 'RESIGN' },
      { seat: 1, type: 'PASS' },
      { seat: 1, type: 'PLACE_WORD', tiles: [] },
    ]) {
      const r = validateAction(s, action, CTX);
      expect(r.ok ? undefined : r.error).toMatchObject({
        code: 'not_your_turn',
        details: { seatOnTurn: 0, seatInactive: true },
        message: 'the seat is no longer active',
      });
    }
  });

  it('4. not_your_turn before placement and exchange checks', () => {
    expect(code(state(), { seat: 1, type: 'PLACE_WORD', tiles: [] })).toBe('not_your_turn');
    expect(code(state(), { seat: 1, type: 'EXCHANGE', tiles: [] })).toBe('not_your_turn');
  });

  it('5. PLACE_WORD: placement, rack and lexicon checks run on the rack of the mover and the board', () => {
    const s = state({}, [{ rack: 'AIMNOST' }]);
    expect(code(s, placeAI)).toBe('PLACE_WORD');
    expect(code(s, { ...placeAI, tiles: [] })).toBe('placement');
    expect(code(state({}, [{ rack: 'BCDEFGH' }]), placeAI)).toBe('rack');
    const aim = { ...placeAI, tiles: [...placeAI.tiles, { row: 7, col: 9, tile: 'M' }] };
    expect(code(s, aim)).toBe('not_in_lexicon');
  });

  it('5. EXCHANGE: exchange then rack checks; PASS accepted', () => {
    const s = state({}, [{ rack: 'AIMNOST' }]);
    expect(code(s, { seat: 0, type: 'EXCHANGE', tiles: ['A', 'I'] })).toBe('EXCHANGE');
    expect(code(s, { seat: 0, type: 'EXCHANGE', tiles: [] })).toBe('exchange');
    expect(
      code(state({ bag: 'ABCDEF' }, [{ rack: 'AIMNOST' }]), {
        seat: 0,
        type: 'EXCHANGE',
        tiles: ['Z'],
      }),
    ).toBe('exchange');
    expect(code(s, { seat: 0, type: 'EXCHANGE', tiles: ['Z'] })).toBe('rack');
    expect(code(s, { seat: 0, type: 'PASS' })).toBe('PASS');
  });

  it('returns the canonical action and the checked placement', () => {
    const s = state({}, [{ rack: 'AIMNOST' }]);
    const r = validateAction(s, { ...placeAI, tiles: [...placeAI.tiles].reverse() }, CTX);
    if (!r.ok || r.value.type !== 'PLACE_WORD') throw new Error('expected PLACE_WORD');
    expect(r.value.action.tiles.map((t) => t.col)).toEqual([7, 8]);
    expect(r.value.placement.rackAfter).toBe('MNOST');
    expect(r.value.placement.words.map((w) => w.form)).toEqual(['AI']);
  });
});
