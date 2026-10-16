/**
 * DG1 review fixes on the timed suites, with injected clocks:
 * - C-4: the clock's resolution is probed (smallest non-zero delta); above 50 µs, or a clock that never advances,
 *   every timed bench is `not-measured` (`clock-resolution`); one discarded warm-up pass before `has()`, `apply`
 *   and each bot group, outside every timed interval;
 * - C-3: `has()` words alternate forms and non-words (true round robin);
 * - C-M2: resume reports the full-replay and the snapshot + tail paths separately, snapshot journals cut at
 *   k × SNAPSHOT_EVERY − 1 (the longest tail);
 * - C-5: every drift match is played from the same seed;
 * - C-6: one constants fit per rack type.
 */
import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { LexiconIndex } from '@codelex/lexicon/index';

import type { LoadedLexicon } from '../../lexicon/load-lexicon';
import { loadBundledLexicon } from '../../match/test-support';
import { SNAPSHOT_EVERY } from '../../persistence/match-journal';
import { createScratchStore } from '../scratch-fs';
import { BOT_GROUPS, botsJob } from './bots';
import { driftJob } from './drift';
import {
  CLOCK_PROBE_DELTAS,
  clockResolutionUs,
  MAX_CLOCK_RESOLUTION_US,
  RUN_ALL_ORDER,
  type Clock,
  type Job,
} from './job';
import { hasWords, interleave, microJob, HAS_BATCH } from './micro';
import { fullReplayCuts, resumeJob, snapshotCuts } from './resume';

jest.mock('expo-asset', () => jest.requireActual('../../../jest/expo-asset.cjs'));
jest.mock('expo-crypto', () => jest.requireActual('../../../jest/expo-crypto.cjs'));
jest.mock('expo-file-system', () => jest.requireActual('../../../jest/expo-file-system.cjs'));

let lexicon: LoadedLexicon;
beforeAll(async () => {
  lexicon = await loadBundledLexicon();
});

/** A clock advancing `stepMs` per reading, counting its readings. */
function steppingClock(stepMs: number): Clock & { reads: () => number } {
  let t = 0;
  let reads = 0;
  const clock = (): number => {
    reads += 1;
    return (t += stepMs);
  };
  return Object.assign(clock, { reads: () => reads });
}

/** A clock with a 1 ms granularity (a coarsened `performance.now`): 100 readings per tick. */
function coarseClock(): Clock {
  let reads = 0;
  return () => Math.floor((reads += 1) / 100);
}

function drain<R>(job: Job<R>): R {
  for (let more = true; more;) more = job.step();
  return job.result();
}

const FINE = 0.01;

/**
 * The index with `has()` counted. The decoded index is frozen (no spy can replace a method), so this is a proxy
 * over a plain copy forwarding every other member to the index itself.
 */
function countingHas(index: LexiconIndex): { lexicon: LexiconIndex; calls: () => number } {
  let calls = 0;
  const has = (form: string): boolean => {
    calls += 1;
    return index.has(form);
  };
  const lexicon = new Proxy(
    { ...index },
    {
      get: (_target, prop): unknown => {
        if (prop === 'has') return has;
        const value: unknown = Reflect.get(index, prop);
        return typeof value === 'function'
          ? (...args: unknown[]): unknown => Reflect.apply(value, index, args)
          : value;
      },
    },
  );
  return { lexicon, calls: () => calls };
}

describe('clock resolution probe (C-4)', () => {
  it('returns the smallest non-zero delta in µs, or null for a clock that never advances', () => {
    expect(clockResolutionUs(steppingClock(FINE))).toBeCloseTo(10, 6);
    expect(clockResolutionUs(coarseClock())).toBe(1000);
    expect(clockResolutionUs(() => 42)).toBeNull();
    const fine = steppingClock(FINE);
    clockResolutionUs(fine);
    expect(fine.reads()).toBe(1 + CLOCK_PROBE_DELTAS);
    expect(MAX_CLOCK_RESOLUTION_US).toBe(50);
  });

  it('marks every timed bench not-measured above 50 µs, without running it', () => {
    const store = createScratchStore();
    const counted = countingHas(lexicon.index);
    for (const clock of [steppingClock(0.051), coarseClock(), () => 7]) {
      const micro = microJob(counted.lexicon, clock, { hasBatches: 2, applyPasses: 1 });
      expect(micro.step()).toBe(false);
      expect(micro.result()).toEqual({ kind: 'failed', reason: 'clock-resolution' });
      expect(drain(botsJob(counted.lexicon, clock, 2))).toEqual({
        kind: 'failed',
        reason: 'clock-resolution',
      });
      expect(
        drain(resumeJob(counted.lexicon, clock, store, { matches: 1, iterations: 1 })),
      ).toEqual({
        kind: 'failed',
        reason: 'clock-resolution',
      });
      expect(drain(driftJob(counted.lexicon, clock, 1))).toEqual({
        kind: 'failed',
        reason: 'clock-resolution',
      });
    }
    expect(counted.calls()).toBe(0);
  });
});

describe('micro-benches (C-3, C-4)', () => {
  it('interleaves forms and non-words, so every batch is half hits', () => {
    expect(interleave([1, 2, 3], [7, 8])).toEqual([1, 7, 2, 8, 3]);
    const words = hasWords(lexicon.index);
    expect(words.slice(0, 6).map((w) => lexicon.index.has(w))).toEqual([
      true,
      false,
      true,
      false,
      true,
      false,
    ]);
  });

  it('runs one discarded warm-up batch and pass before the timed ones', () => {
    const counted = countingHas(lexicon.index);
    const clock = steppingClock(FINE);
    const job = microJob(counted.lexicon, clock, { hasBatches: 3, applyPasses: 2 });
    expect(job.progress().total).toBe(3 + 2 + 2);
    const result = drain(job);
    if (result.kind !== 'measured') throw new Error('not measured');
    expect(result.has?.samples).toBe(3);
    // 10 µs per batch of 1,000 calls is 10 ns per call (a batch mean, not a per-call percentile).
    expect(result.has?.max).toBe(10);
    expect(counted.calls()).toBeGreaterThanOrEqual((3 + 1) * HAS_BATCH);
    const applySamples = result.apply?.samples ?? 0;
    expect(applySamples % 2).toBe(0);
    // Only the timed batches and the timed `apply` calls read the clock (two readings each), after the probe.
    expect(clock.reads()).toBe(1 + CLOCK_PROBE_DELTAS + 2 * 3 + 2 * applySamples);
  });
});

describe('bot compute (C-4, C-6)', () => {
  it('warms each group up once, times every position, and fits constants per rack type', () => {
    const clock = steppingClock(FINE);
    const job = botsJob(lexicon.index, clock, 2);
    const result = drain(job);
    if (result.kind !== 'measured') throw new Error(result.reason);
    expect(result.groups.map((g) => g.timingUs.samples)).toEqual(BOT_GROUPS.map(() => 2));
    expect(job.progress()).toEqual({ done: job.progress().total, total: 2 * 5 + 4 });
    // Two decisions per group are too few for a fit: each rack type is fitted on its own.
    expect(result.constants).toEqual({ ordinary: null, twoBlanks: null });
    expect(clock.reads()).toBe(1 + CLOCK_PROBE_DELTAS + 2 * 2 * BOT_GROUPS.length);
  });
});

describe('resume probe (C-M2)', () => {
  it('cuts full replays at the longest journal and snapshots at k × 10 − 1', () => {
    expect(SNAPSHOT_EVERY).toBe(10);
    expect(fullReplayCuts(null)).toEqual([30, 60, 90]);
    expect(fullReplayCuts(46)).toEqual([30, 45]);
    expect(fullReplayCuts(20)).toEqual([19]);
    expect(snapshotCuts(null)).toEqual([29, 59, 89]);
    expect(snapshotCuts(46)).toEqual([29, 39]);
    expect(snapshotCuts(20)).toEqual([19]);
    expect(snapshotCuts(9)).toEqual([]);
  });

  it('reports the full-replay and the snapshot + tail paths as two distributions', () => {
    const result = drain(
      resumeJob(lexicon.index, steppingClock(FINE), createScratchStore(), {
        matches: 1,
        iterations: 2,
      }),
    );
    if (result.kind !== 'measured') throw new Error(result.reason);
    expect(result.fullReplay.samples).toBe(2 * 2);
    expect(result.snapshotTail.samples).toBe(2 * 2);
  });
});

describe('drift (C-5)', () => {
  it('plays every match from the same seed, first in a full run', () => {
    expect(RUN_ALL_ORDER[0]).toBe('drift');
    const result = drain(driftJob(lexicon.index, steppingClock(FINE), 2));
    if (result.kind !== 'measured') throw new Error(result.reason);
    expect(result.matches).toHaveLength(2);
    expect(result.matches[1]?.decisions).toBe(result.matches[0]?.decisions);
  });
});
