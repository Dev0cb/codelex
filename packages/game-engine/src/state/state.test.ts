import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { playSteps, seedOf } from '../../test/support/play.js';
import { CTX, config1v1 } from '../../test/support/small-lexicon.js';
import { apply } from '../match/apply.js';
import { createMatch } from '../match/create.js';
import type { MatchState } from '../types.js';
import { parseState, serializeState, stateHash } from './state.js';

const created = createMatch(config1v1(), CTX);
if (!created.ok) throw new Error('fixture');
const START = created.value.state;
const resigned = apply(START, { seat: 1, type: 'RESIGN' }, CTX);
if (!resigned.ok) throw new Error('fixture');
const FINISHED = resigned.value.state;

/** Six passes from the start: R-TURN-004 in 1v1. */
const SCORELESS = ((): MatchState => {
  let s = START;
  while (s.status === 'in_progress') {
    const r = apply(s, { seat: s.seatOnTurn, type: 'PASS' }, CTX);
    if (!r.ok) throw new Error('fixture');
    s = r.value.state;
  }
  return s;
})();

/** The first 1v1 match of the generated corpus that ends by going out (R-END-001). */
const GOING_OUT = ((): MatchState => {
  for (let i = 0; ; i += 1) {
    const s = playSteps(seedOf(i), 2, 500).states.at(-1);
    if (s?.result?.end.reason === 'going_out') return s;
  }
})();

/** Field reported for a state document mutated by `edit` (on a JSON copy). */
function problem(edit: (doc: Record<string, unknown>) => void, base: MatchState = START): unknown {
  const doc = JSON.parse(serializeState(base)) as Record<string, unknown>;
  edit(doc);
  const r = parseState(JSON.stringify(doc));
  return r.ok
    ? 'ok'
    : r.error.code === 'MALFORMED_STATE'
      ? r.error.details?.['field']
      : r.error.code;
}

const seat0 = (doc: Record<string, unknown>): Record<string, unknown> =>
  (doc['seats'] as Record<string, unknown>[])[0] as Record<string, unknown>;
const result = (doc: Record<string, unknown>): Record<string, unknown> =>
  doc['result'] as Record<string, unknown>;

describe('serializeState / stateHash (ADR-0013 §D3)', () => {
  it('serialises to sorted-key ASCII JCS and hashes to 16 hex chars', () => {
    const text = serializeState(START);
    expect(text.startsWith('{"actionCount":0,"bag":"')).toBe(true);
    expect(stateHash(START)).toMatch(/^[0-9a-f]{16}$/);
    expect(stateHash({ ...START })).toBe(stateHash(START));
    expect(stateHash({ ...START, turnNumber: 1 })).not.toBe(stateHash(START));
  });

  it('throws on a value outside the subset (programmer error)', () => {
    expect(() => serializeState({ ...START, scorelessTurns: 0.5 })).toThrow(RangeError);
  });
});

describe('parseState (P-GLOBAL-04, API note §13.6)', () => {
  it('round-trips in-progress and finished states', () => {
    for (const s of [START, FINISHED]) {
      const r = parseState(serializeState(s));
      expect(r.ok && r.value).toEqual(s);
      expect(r.ok && stateHash(r.value)).toBe(stateHash(s));
    }
  });

  it('RULES_VERSION_UNSUPPORTED before MALFORMED_STATE', () => {
    expect(problem((d) => ((d['engineRulesVersion'] = 2), (d['bag'] = 7)))).toBe(
      'RULES_VERSION_UNSUPPORTED',
    );
  });

  it('m1: an unsupported engineRulesVersion of any JSON type is reported without stringifying it', () => {
    const actual = (text: string): unknown => {
      const r = parseState(text);
      return r.ok
        ? 'ok'
        : r.error.code === 'RULES_VERSION_UNSUPPORTED' && r.error.details?.['actual'];
    };
    expect(actual('{"engineRulesVersion":{"toString":1}}')).toBe('object');
    expect(actual('{"engineRulesVersion":{"toString":{},"valueOf":{}}}')).toBe('object');
    expect(actual('{"engineRulesVersion":[1]}')).toBe('object');
    expect(actual('{"engineRulesVersion":null}')).toBe('object');
    expect(actual('{"engineRulesVersion":true}')).toBe('boolean');
    expect(actual('{}')).toBe('undefined');
    expect(actual('{"engineRulesVersion":"1"}')).toBe('1');
    expect(actual('{"engineRulesVersion":2}')).toBe(2);
    expect(actual('{"engineRulesVersion":1.5}')).toBe(1.5);
    expect(actual('{"engineRulesVersion":1e400}')).toBe('number'); // Infinity: no non-finite number in details
  });

  it.each([
    ['not JSON', null],
    ['not an object', null],
  ])('MALFORMED_STATE at the root for %s', (name) => {
    const text = name === 'not JSON' ? '{' : '[1]';
    const r = parseState(text);
    expect(r.ok ? undefined : r.error).toMatchObject({
      code: 'MALFORMED_STATE',
      details: { field: '' },
    });
  });

  it.each<[string, (d: Record<string, unknown>) => void]>([
    ['extra', (d) => (d['extra'] = 1)],
    ['bag', (d) => delete d['bag']],
    ['seed', (d) => (d['seed'] = 'nope')],
    ['config.teams', (d) => ((d['config'] as Record<string, unknown>)['teams'] = [[1], [0]])],
    ['status', (d) => (d['status'] = 'paused')],
    ['firstSeat', (d) => (d['firstSeat'] = 2)],
    ['seatOnTurn', (d) => (d['seatOnTurn'] = -1)],
    ['turnNumber', (d) => (d['turnNumber'] = 1.5)],
    ['actionCount', (d) => (d['actionCount'] = '0')],
    ['board', (d) => (d['board'] = ['.'])],
    ['board', (d) => ((d['board'] as string[])[3] = '..............1')],
    ['bag', (d) => (d['bag'] = 'abc')],
    ['rng', (d) => (d['rng'] = { bag: [1, 2, 3, 4], x: 1 })],
    ['rng.bag', (d) => (d['rng'] = { bag: [0, 0, 0, 0] })],
    ['rng.bag', (d) => (d['rng'] = { bag: [1, 2, 3, 2 ** 32] })],
    ['seats', (d) => (d['seats'] = [])],
    ['seats[0]', (d) => ((d['seats'] as unknown[])[0] = 'x')],
    ['seats[0].x', (d) => (seat0(d)['x'] = 1)],
    ['seats[0].rack', (d) => (seat0(d)['rack'] = 'ZA')],
    ['seats[0].rack', (d) => (seat0(d)['rack'] = 'AAAAAAAA')],
    ['seats[0].score', (d) => (seat0(d)['score'] = 0.5)],
    ['seats[0].chainK', (d) => (seat0(d)['chainK'] = 6)],
    ['seats[0].lastMainForm', (d) => (seat0(d)['lastMainForm'] = 'a')],
    ['seats[0].bestTurnScore', (d) => (seat0(d)['bestTurnScore'] = -1)],
    ['seats[0].status', (d) => (seat0(d)['status'] = 'gone')],
    ['result', (d) => (d['result'] = FINISHED.result)],
  ])('MALFORMED_STATE at %s', (field, edit) => {
    expect(problem(edit)).toBe(field);
  });

  it('checks tile conservation (R-BAG-004)', () => {
    expect(problem((d) => (d['bag'] = `${String(d['bag'])}A`))).toBe('conservation');
    expect(
      problem((d) => {
        // Move one bag tile onto the board as a blank: the multiset changes (a blank appears).
        const bag = String(d['bag']);
        d['bag'] = bag.slice(1);
        (d['board'] as string[])[0] = `a${'.'.repeat(14)}`;
      }),
    ).toBe('conservation');
  });

  it.each<[string, (d: Record<string, unknown>) => void]>([
    ['result', (d) => delete d['result']],
    ['result', (d) => (d['result'] = 1)],
    ['result.x', (d) => (result(d)['x'] = 1)],
    ['result.end', (d) => (result(d)['end'] = { reason: 'timeout' })],
    ['result.end', (d) => (result(d)['end'] = 'x')],
    ['result.end', (d) => (result(d)['end'] = { reason: 'resign', seat: 5 })],
    ['result.end', (d) => (result(d)['end'] = { reason: 'scoreless_turns', seat: 0 })],
    ['result.adjustments', (d) => (result(d)['adjustments'] = [0])],
    ['result.teamScores', (d) => (result(d)['teamScores'] = [0, 0.5])],
    ['result.places', (d) => (result(d)['places'] = [1, 3])],
    ['result.decidedBy', (d) => (result(d)['decidedBy'] = 'coin')],
  ])('finished state: MALFORMED_STATE at %s', (field, edit) => {
    expect(problem(edit, FINISHED)).toBe(field);
  });

  it('accepts a scoreless_turns end without a seat', () => {
    expect(SCORELESS.result?.end).toEqual({ reason: 'scoreless_turns' });
    expect(problem(() => undefined, SCORELESS)).toBe('ok');
  });
});

describe('parseState rejects wedged or inconsistent states (review R1 m2)', () => {
  it.each<[string, (d: Record<string, unknown>) => void]>([
    // v1 produces only active and resigned seats.
    ['seats[0].status', (d) => (seat0(d)['status'] = 'forfeited')],
    ['seats[0].status', (d) => (seat0(d)['status'] = 'eliminated')],
    // R-SCORE-005: a chain needs a previous main word.
    ['seats[0].chainK', (d) => (seat0(d)['chainK'] = 1)],
    // in_progress: the seat on turn is active and ≥ 2 teams are still active (R-END-002).
    [
      'seatOnTurn',
      (d) => {
        const seats = d['seats'] as Record<string, unknown>[];
        (seats[d['seatOnTurn'] as number] as Record<string, unknown>)['status'] = 'resigned';
      },
    ],
    [
      'seats',
      (d) => {
        const seats = d['seats'] as Record<string, unknown>[];
        (seats[1 - (d['seatOnTurn'] as number)] as Record<string, unknown>)['status'] = 'resigned';
      },
    ],
  ])('in progress: MALFORMED_STATE at %s', (field, edit) => {
    expect(problem(edit)).toBe(field);
  });

  it('accepts a chain with a previous main word', () => {
    expect(problem((d) => ((seat0(d)['chainK'] = 1), (seat0(d)['lastMainForm'] = 'TCP')))).toBe(
      'ok',
    );
  });

  it.each<[string, MatchState, (d: Record<string, unknown>) => void]>([
    // The end reason must match the seats.
    ['result.end', FINISHED, (d) => (result(d)['end'] = { reason: 'scoreless_turns' })],
    ['result.end', FINISHED, (d) => (result(d)['end'] = { reason: 'resign', seat: 0 })],
    ['result.end', FINISHED, (d) => (result(d)['end'] = { reason: 'going_out', seat: 0 })],
    ['result.end', SCORELESS, (d) => (d['scorelessTurns'] = 5)],
    ['result.end', SCORELESS, (d) => (result(d)['end'] = { reason: 'resign', seat: 0 })],
    ['result.end', SCORELESS, (d) => (result(d)['end'] = { reason: 'going_out', seat: 0 })],
    // Adjustments, team scores, places and decidedBy are recomputed from the seats.
    ['result.adjustments', SCORELESS, (d) => (result(d)['adjustments'] = [0, 0])],
    ['result.adjustments', FINISHED, (d) => (result(d)['adjustments'] = [1, -1])],
    ['result.teamScores', FINISHED, (d) => (result(d)['teamScores'] = [0, 1])],
    ['result.teamScores', SCORELESS, (d) => (seat0(d)['score'] = 1000)],
    ['result.places', FINISHED, (d) => (result(d)['places'] = [2, 1])],
    ['result.decidedBy', FINISHED, (d) => (result(d)['decidedBy'] = 'score')],
  ])('finished: MALFORMED_STATE at %s', (field, base, edit) => {
    expect(problem(edit, base)).toBe(field);
  });

  it('going_out: the seat that went out has an empty rack and the bag is empty (R-END-001)', () => {
    const out = GOING_OUT;
    const goer = out.result?.end.reason === 'going_out' ? out.result.end.seat : -1;
    expect(problem(() => undefined, out)).toBe('ok');
    const other = 1 - goer;
    expect(problem((d) => (result(d)['end'] = { reason: 'going_out', seat: other }), out)).toBe(
      'result.end',
    );
  });

  it('PBT: every reachable state parses (no over-rejection) and round-trips', () => {
    fc.assert(
      fc.property(fc.nat(2000), fc.constantFrom(2, 3, 4), fc.nat(200), (i, seats, steps) => {
        const played = playSteps(seedOf(i), seats, steps);
        for (const s of [played.states.at(-1), played.states[played.states.length >> 1]]) {
          if (s === undefined) continue;
          const r = parseState(serializeState(s));
          if (!r.ok) throw new Error(JSON.stringify(r.error));
          expect(r.value).toEqual(s);
        }
      }),
      { seed: 2610, numRuns: 60 },
    );
  });
});
