/**
 * Non-gating timing of the hot paths over GC-DET-01 (API note §18 budgets; review R1 m4). Run with
 * `pnpm --filter @codelex/game-engine bench`; never part of `test`. Vitest owns the clock (tinybench), so this file
 * reads no clock itself and the determinism lint applies unchanged. Nothing here asserts a time bound: the numbers
 * are printed and recorded by hand in the API note.
 */
import { expect, test } from 'vitest';
import gcDet01Log from '../golden/replays/v1/gc-det-01.log.json' with { type: 'json' };
import { GC_DET_01_CTX } from '../support/gc-det-01-lexicon.js';
import type * as EngineModule from '../../src/index.js';
import type { MatchState, PlaceWordAction } from '../../src/types.js';

// The built package (what apps and services ship), loaded natively by Node (`server.deps.external` in
// vitest.bench.config.ts) so the test module runner adds no per-call overhead. Types come from the sources.
const DIST_ENTRY = '../../dist/index.js';
const {
  apply,
  createMatch,
  evaluateMove,
  observe,
  parseActionLog,
  previewScore,
  replay,
  serializeState,
  stateHash,
} = (await import(/* @vite-ignore */ DIST_ENTRY)) as typeof EngineModule;

const parsed = parseActionLog(JSON.stringify(gcDet01Log));
if (!parsed.ok) throw new Error(parsed.error.code);
const log = parsed.value;
const outcome = replay(log, GC_DET_01_CTX);
if (!outcome.ok) throw new Error(outcome.error.code);
/** The same log without the per-action checkpoints (`final` only). */
const bare = {
  logVersion: log.logVersion,
  header: log.header,
  actions: log.actions,
  ...(log.final ? { final: log.final } : {}),
};

/** Every state of GC-DET-01: `states[i]` is the state before action i. */
const states: MatchState[] = [];
{
  const created = createMatch(log.header, GC_DET_01_CTX);
  if (!created.ok) throw new Error(created.error.code);
  let s = created.value.state;
  for (const action of log.actions) {
    states.push(s);
    const r = apply(s, action, GC_DET_01_CTX);
    if (!r.ok) throw new Error('golden action rejected');
    s = r.value.state;
  }
}

/** The first PLACE_WORD at or after the middle of the match (a crowded mid-game board). */
const midIndex = log.actions.findIndex((a, i) => i >= 45 && a.type === 'PLACE_WORD');
const mid = states[midIndex] as MatchState;
const midAction = log.actions[midIndex] as PlaceWordAction;
const midObservation = observe(mid, midAction.seat);

interface Row {
  readonly name: string;
  readonly callsPerIteration: number;
  readonly mean: number;
  readonly p50: number;
  readonly p99: number;
}

function row(name: string, latency: { mean: number; p50: number; p99: number }, calls = 1): Row {
  const us = (ms: number): number => Math.round((ms * 1000) / calls);
  return {
    name,
    callsPerIteration: calls,
    mean: us(latency.mean),
    p50: us(latency.p50),
    p99: us(latency.p99),
  };
}

test('engine hot paths over GC-DET-01 (µs per call; non-gating)', async ({ bench }) => {
  const results = await bench.compare(
    bench('apply ×90 (whole GC-DET-01 sequence)', () => {
      for (let i = 0; i < states.length; i += 1) {
        apply(states[i] as MatchState, log.actions[i] as PlaceWordAction, GC_DET_01_CTX);
      }
    }),
    bench('apply (mid-game PLACE_WORD)', () => {
      apply(mid, midAction, GC_DET_01_CTX);
    }),
    bench('evaluateMove (mid-game PLACE_WORD)', () => {
      evaluateMove(midObservation, midAction, GC_DET_01_CTX);
    }),
    bench('previewScore (mid-game PLACE_WORD)', () => {
      previewScore(midObservation, midAction.tiles);
    }),
    bench('observe (mid-game, seat)', () => {
      observe(mid, midAction.seat);
    }),
    bench('serializeState (mid-game)', () => {
      serializeState(mid);
    }),
    bench('stateHash (mid-game)', () => {
      stateHash(mid);
    }),
    bench('replay GC-DET-01 (90 actions, final hash only)', () => {
      replay(bare, GC_DET_01_CTX);
    }),
    bench('replay GC-DET-01 (90 actions, verifying 90 stateHashes + final)', () => {
      replay(log, GC_DET_01_CTX);
    }),
  );
  const rows: Row[] = [
    row(
      'apply (GC-DET-01 average)',
      results.get('apply ×90 (whole GC-DET-01 sequence)').latency,
      90,
    ),
    row('apply (mid-game)', results.get('apply (mid-game PLACE_WORD)').latency),
    row('evaluateMove', results.get('evaluateMove (mid-game PLACE_WORD)').latency),
    row('previewScore', results.get('previewScore (mid-game PLACE_WORD)').latency),
    row('observe', results.get('observe (mid-game, seat)').latency),
    row('serializeState', results.get('serializeState (mid-game)').latency),
    row('stateHash', results.get('stateHash (mid-game)').latency),
    row(
      'replay (final hash only)',
      results.get('replay GC-DET-01 (90 actions, final hash only)').latency,
    ),
    row(
      'replay (all 90 hashes verified)',
      results.get('replay GC-DET-01 (90 actions, verifying 90 stateHashes + final)').latency,
    ),
  ];
  console.table(rows);
  // Sanity only (not a budget): every measurement produced a number.
  for (const r of rows) expect(Number.isFinite(r.p99)).toBe(true);
});
