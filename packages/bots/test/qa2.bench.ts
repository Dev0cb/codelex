/**
 * Q-A2 measurement (bots-api §6, lexicon-index §9), non-gating: `pnpm --filter @codelex/bots bench`
 * (vitest.bench.config.ts; not part of `pnpm test`).
 *
 * For each fixture (real lexicon, 2,000- and 50,000-form synthetic), 200 seeded mid-game positions are taken from
 * Beginner mirror games (every on-turn observation from action 2 on). For each position, unbounded GADDAG
 * generation is run; nodes and candidates are exact counts (device-independent) and printed as p50/p95/max, plus
 * the same positions with two blanks on the rack (worst case). Time comes from the Vitest bench harness (each
 * iteration handles the next position round-robin, so latency percentiles are per-position Node ms), never from a
 * clock read here.
 *
 * GADDAG only: the DAWG half of Q-A2 (and P-BOT-03) completes once L5 exposes `LexiconIndex.dawg` (O-1).
 * The GADDAG is the test-only unminimised builder (test/support/gaddag.ts); node counts do not depend on
 * minimisation, timings may.
 */
import { getLayout, type Observation } from '@codelex/game-engine';
import type { LexiconIndex } from '@codelex/lexicon/index';
import { describe, test } from 'vitest';
import { boardView } from '../src/board.js';
import { generateFor } from './support/generation.js';
import { realIndex, syntheticIndex } from './support/lexicons.js';
import { play, seedOf } from './support/match.js';

const POSITIONS = 200;
const ITERATIONS = 1_000;
const LAYOUT = getLayout('classic-v1');

function positionsFor(lexicon: LexiconIndex): Observation[] {
  const out: Observation[] = [];
  for (let game = 0; out.length < POSITIONS && game < 2_000; game += 1) {
    play({
      lexicon,
      seed: seedOf(9_000 + game),
      personalities: ['beginner', 'beginner'],
      onStep: ({ observation }) => {
        if (observation.actionCount >= 2 && out.length < POSITIONS) out.push(observation);
      },
    });
  }
  return out;
}

function withTwoBlanks(obs: Observation): Observation {
  return { ...obs, rack: `??${obs.rack.replace(/\?/g, '').slice(2)}` };
}

function percentile(sorted: ArrayLike<number>, pct: number): number {
  return sorted[Math.floor(((sorted.length - 1) * pct) / 100)] ?? 0;
}

function stats(values: readonly number[]): { p50: number; p95: number; max: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return { p50: percentile(sorted, 50), p95: percentile(sorted, 95), max: percentile(sorted, 100) };
}

interface LatencyResult {
  readonly latency: {
    readonly mean: number;
    readonly p50: number;
    readonly p99: number;
    readonly max: number;
    readonly samples?: ArrayLike<number> | undefined;
  };
}

/** Per-position latency summary in ms (3 decimals); p95 from the retained samples. */
function latency(result: LatencyResult): Record<string, number> {
  const { mean, p50, p99, max, samples } = result.latency;
  const sorted = samples === undefined ? [] : Array.from(samples).sort((a, b) => a - b);
  const p95 = sorted.length > 0 ? percentile(sorted, 95) : p99;
  const round = (x: number): number => Math.round(x * 1_000) / 1_000;
  return { mean: round(mean), p50: round(p50), p95: round(p95), p99: round(p99), max: round(max) };
}

interface Fixture {
  readonly name: string;
  readonly lexicon: LexiconIndex;
}

const FIXTURES: readonly Fixture[] = [
  { name: `real (${String(realIndex().size)} forms)`, lexicon: realIndex() },
  { name: 'synthetic 2,000 forms', lexicon: syntheticIndex(2_000) },
  { name: 'synthetic 50,000 forms', lexicon: syntheticIndex(50_000) },
];

for (const { name, lexicon } of FIXTURES) {
  describe(`Q-A2 ${name}`, () => {
    const positions = positionsFor(lexicon);

    test('node counts (unbounded generation)', () => {
      const plain = positions.map((obs) => generateFor(obs, lexicon));
      const blanks = positions.map((obs) => generateFor(withTwoBlanks(obs), lexicon));
      const report = {
        fixture: name,
        positions: positions.length,
        nodes: stats(plain.map((g) => g.nodesUsed)),
        candidates: stats(plain.map((g) => g.candidates.length)),
        twoBlankNodes: stats(blanks.map((g) => g.nodesUsed)),
        twoBlankCandidates: stats(blanks.map((g) => g.candidates.length)),
        twoBlankOver200kNodes: blanks.filter((g) => g.nodesUsed > 200_000).length,
        twoBlankOver400kNodes: blanks.filter((g) => g.nodesUsed > 400_000).length,
      };
      console.log(`Q-A2 nodes ${JSON.stringify(report)}`);
    });

    test('per-position time (Node ms)', async ({ bench }) => {
      let i = 0;
      let j = 0;
      let k = 0;
      const at = (n: number): Observation => positions[n % positions.length] as Observation;
      const options = { iterations: ITERATIONS, time: 0, retainSamples: true };
      const fixed = await bench('fixed cost: board view + cross-checks', () => {
        boardView(at(i++), LAYOUT, lexicon);
      }).run(options);
      const gaddag = await bench('GADDAG generation, unbounded', () => {
        generateFor(at(j++), lexicon);
      }).run(options);
      const blanks = await bench('GADDAG generation, unbounded, two blanks', () => {
        generateFor(withTwoBlanks(at(k++)), lexicon);
      }).run({ ...options, iterations: POSITIONS });
      const report = {
        fixture: name,
        fixedCost: latency(fixed),
        gaddag: latency(gaddag),
        gaddagTwoBlanks: latency(blanks),
      };
      console.log(`Q-A2 time ${JSON.stringify(report)}`);
    });
  });
}
