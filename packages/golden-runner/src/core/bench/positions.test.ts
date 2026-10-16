import { apply, observe } from '@codelex/game-engine';
import { actionKey } from '@codelex/bots';
import { describe, expect, it } from 'vitest';

import { syntheticClxiIndex } from '../fixtures/bot-fixtures.js';
import {
  BENCH_POSITIONS,
  benchDecision,
  benchSeed,
  createPositionSource,
  playBenchStep,
  startBenchMatch,
  withTwoBlanks,
} from './positions.js';

const lexicon = syntheticClxiIndex(2000, 1);

function collect(count?: number): ReturnType<typeof createPositionSource> {
  const source = createPositionSource(lexicon, count);
  let steps = 0;
  while (source.step()) steps += 1;
  expect(steps).toBeGreaterThan(0);
  return source;
}

describe('bench positions (P5 §2 generator, one decision per step)', { timeout: 120_000 }, () => {
  it('uses the seeds of packages/bots/test/support seedOf', () => {
    expect(benchSeed(9000)).toBe('000000004e4e9595');
    expect(benchSeed(0)).toBe('0000000000005eed');
  });

  it('collects 200 on-turn positions from action 2 on, deterministically', () => {
    const first = collect();
    expect(first.positions).toHaveLength(BENCH_POSITIONS);
    expect(first.positions.every((p) => p.observation.actionCount >= 2)).toBe(true);
    expect(new Set(first.positions.map((p) => p.id)).size).toBe(BENCH_POSITIONS);
    expect(first.positions[0]?.id).toBe(`${benchSeed(9000)}/2`);
    const again = collect();
    expect(again.positions.map((p) => p.id)).toEqual(first.positions.map((p) => p.id));
    expect(first.step()).toBe(false);
  });

  it('decides each position with the frozen budget, the same way twice', () => {
    const [position] = collect(3).positions;
    if (position === undefined) throw new Error('no position');
    const a = benchDecision(lexicon, position, 'strategist');
    const b = benchDecision(lexicon, position, 'strategist');
    if (!a.ok || !b.ok) throw new Error('bot decision failed');
    expect(a.value.action.type).not.toBe('RESIGN');
    expect(b.value.action.type).not.toBe('RESIGN');
    if (a.value.action.type === 'RESIGN' || b.value.action.type === 'RESIGN') return;
    expect(actionKey(a.value.action)).toBe(actionKey(b.value.action));
  });

  it('forces two blanks into the rack, keeping its length', () => {
    const [position] = collect(1).positions;
    if (position === undefined) throw new Error('no position');
    const blanks = withTwoBlanks(position);
    expect(blanks.observation.rack.startsWith('??')).toBe(true);
    expect(blanks.observation.rack).toHaveLength(position.observation.rack.length);
    expect(blanks.id).toBe(position.id);
    const decided = benchDecision(lexicon, blanks, 'beginner');
    expect(decided.ok).toBe(true);
  });

  it('plays a step as the bots play loop does', () => {
    const state = startBenchMatch(lexicon, benchSeed(1));
    const next = playBenchStep(lexicon, state, 'beginner');
    expect(next.actionCount).toBe(1);
    // The same action the engine accepts from the observation's own decision.
    const position = { id: 'x', seed: state.seed, observation: observe(state, state.seatOnTurn) };
    const decided = benchDecision(lexicon, position, 'beginner');
    if (!decided.ok) throw new Error('bot failed');
    const applied = apply(state, decided.value.action, { lexicon });
    expect(applied.ok && applied.value.state.actionCount).toBe(1);
  });

  it('stops at the game bound when no position can be collected', () => {
    const source = createPositionSource(lexicon, 0);
    expect(source.step()).toBe(false);
    expect(source.positions).toHaveLength(0);
  });
});
