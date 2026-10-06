import { describe, expect, it } from 'vitest';
import { CTX, config1v1 } from '../../test/support/small-lexicon.js';
import { rulesFor } from '../rules/registry.js';
import type { MatchState } from '../types.js';
import { apply } from './apply.js';
import { createMatch } from './create.js';
import { exchangeEligibility, observe } from './observe.js';

const created = createMatch(config1v1(), CTX);
if (!created.ok) throw new Error('fixture');
const START: MatchState = { ...created.value.state, seatOnTurn: 0 };
const MIN = rulesFor(1).rules.minBagForExchange;

const withBag = (size: number): MatchState => ({ ...START, bag: START.bag.slice(0, size) });

describe('exchangeEligibility (R-TURN-001)', () => {
  it('allows the seat on turn with at least the rules minimum in the bag', () => {
    expect(exchangeEligibility(observe(withBag(MIN), 0))).toEqual({
      ok: true,
      reason: null,
      minBag: MIN,
    });
  });

  it('refuses below the minimum with bag_too_small, exactly when apply rejects bag_too_small', () => {
    const state = withBag(MIN - 1);
    expect(exchangeEligibility(observe(state, 0))).toEqual({
      ok: false,
      reason: 'bag_too_small',
      minBag: MIN,
    });
    const tile = state.seats[0]?.rack.charAt(0) ?? '';
    const applied = apply(state, { seat: 0, type: 'EXCHANGE', tiles: [tile as 'A'] }, CTX);
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.error).toMatchObject({
      code: 'exchange',
      details: { violation: 'bag_too_small' },
    });
  });

  it('agrees with apply on every bag size from 0 to the minimum + 1', () => {
    for (let size = 0; size <= MIN + 1; size += 1) {
      const state = withBag(size);
      const tile = state.seats[0]?.rack.charAt(0) ?? '';
      const applied = apply(state, { seat: 0, type: 'EXCHANGE', tiles: [tile as 'A'] }, CTX);
      expect(exchangeEligibility(observe(state, 0)).ok).toBe(applied.ok);
    }
  });

  it('refuses out of turn, for spectators, for resigned seats and once the match is over', () => {
    expect(exchangeEligibility(observe(START, 1)).reason).toBe('not_your_turn');
    expect(exchangeEligibility(observe(START, 'spectator')).reason).toBe('not_your_turn');
    const resigned: MatchState = {
      ...START,
      seats: START.seats.map((s, i) => (i === 0 ? { ...s, status: 'resigned' } : s)),
    };
    expect(exchangeEligibility(observe(resigned, 0)).reason).toBe('not_your_turn');
    const over = apply(START, { seat: 0, type: 'RESIGN' }, CTX);
    if (!over.ok) throw new Error('fixture');
    expect(exchangeEligibility(observe(over.value.state, 1))).toEqual({
      ok: false,
      reason: 'match_over',
      minBag: MIN,
    });
  });

  it('refuses when the rules version does not resolve', () => {
    const observation = { ...observe(START, 0), engineRulesVersion: 99 as 1 };
    expect(exchangeEligibility(observation)).toEqual({ ok: false, reason: 'rules', minBag: 0 });
  });
});
