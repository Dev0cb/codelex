/**
 * Q-A2 measurement (bots-api §6, lexicon-index §9), non-gating: `pnpm --filter @codelex/bots bench`
 * (vitest.bench.config.ts; not part of `pnpm test`).
 *
 * For each fixture (real lexicon, 2,000- and 50,000-form synthetic), built as a `.clxi` artefact and decoded (the
 * shipped minimal automata) once with and once without the GADDAG section, 200 seeded mid-game positions are taken
 * from Beginner mirror games (every on-turn observation from action 2 on). For each position, unbounded GADDAG
 * and DAWG generation are run; nodes and candidates are exact counts (device-independent) and printed as
 * p50/p95/max, plus the same positions with two blanks on the rack (worst case). The candidate sets are checked
 * equal (P-BOT-03). Time comes from the Vitest bench harness (each iteration handles the next position
 * round-robin, so latency percentiles are per-position Node ms), never from a clock read here.
 */
import { getLayout, type Observation } from '@codelex/game-engine';
import type { LexiconIndex } from '@codelex/lexicon/index';
import { describe, test } from 'vitest';
import { boardView } from '../src/board.js';
import { generateFor } from './support/generation.js';
import type { Generation } from '../src/movegen/index.js';
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
  readonly gaddag: LexiconIndex;
  readonly dawg: LexiconIndex;
}

const real = realIndex({ clxi: true });
const FIXTURES: readonly Fixture[] = [
  {
    name: `real (${String(real.size)} forms)`,
    gaddag: real,
    dawg: realIndex({ clxi: true, gaddag: false }),
  },
  ...(
    [
      [2_000, '2,000'],
      [50_000, '50,000'],
    ] as const
  ).map(([size, label]) => ({
    name: `synthetic ${label} forms`,
    gaddag: syntheticIndex(size, 1, { clxi: true }),
    dawg: syntheticIndex(size, 1, { clxi: true, gaddag: false }),
  })),
];

function sameKeys(a: Generation, b: Generation): boolean {
  const keys = (g: Generation): string =>
    g.candidates
      .map((c) => c.key)
      .sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))
      .join(',');
  return keys(a) === keys(b);
}

for (const fixture of FIXTURES) {
  const { name } = fixture;
  describe(`Q-A2 ${name}`, () => {
    const positions = positionsFor(fixture.gaddag);

    test('node counts (unbounded generation)', () => {
      const report: Record<string, unknown> = { fixture: name, positions: positions.length };
      const runs = (['gaddag', 'dawg'] as const).map((kind) => {
        const lexicon = fixture[kind];
        const plain = positions.map((obs) => generateFor(obs, lexicon));
        const blanks = positions.map((obs) => generateFor(withTwoBlanks(obs), lexicon));
        report[kind] = {
          nodes: stats(plain.map((g) => g.nodesUsed)),
          candidates: stats(plain.map((g) => g.candidates.length)),
          twoBlankNodes: stats(blanks.map((g) => g.nodesUsed)),
          twoBlankCandidates: stats(blanks.map((g) => g.candidates.length)),
          twoBlankOver200kNodes: blanks.filter((g) => g.nodesUsed > 200_000).length,
          twoBlankOver400kNodes: blanks.filter((g) => g.nodesUsed > 400_000).length,
        };
        return [...plain, ...blanks];
      });
      const [viaGaddag = [], viaDawg = []] = runs;
      const ratios = viaGaddag.map((g, n) =>
        Math.round(((viaDawg[n]?.nodesUsed ?? 0) * 100) / Math.max(1, g.nodesUsed)),
      );
      report['dawgOverGaddagNodesPercent'] = stats(ratios.slice(0, positions.length));
      report['sameMoveSet'] = viaGaddag.every((g, n) => {
        const d = viaDawg[n];
        return d !== undefined && sameKeys(g, d);
      });
      console.log(`Q-A2 nodes ${JSON.stringify(report)}`);
    });

    test('per-position time (Node ms)', async ({ bench }) => {
      const at = (n: number): Observation => positions[n % positions.length] as Observation;
      const options = { iterations: ITERATIONS, time: 0, retainSamples: true };
      let i = 0;
      const fixed = await bench('fixed cost: board view + cross-checks', () => {
        boardView(at(i++), LAYOUT, fixture.gaddag);
      }).run(options);
      const report: Record<string, unknown> = { fixture: name, fixedCost: latency(fixed) };
      for (const kind of ['gaddag', 'dawg'] as const) {
        const lexicon = fixture[kind];
        let j = 0;
        let k = 0;
        const plain = await bench(`${kind} generation, unbounded`, () => {
          generateFor(at(j++), lexicon);
        }).run(options);
        const blanks = await bench(`${kind} generation, unbounded, two blanks`, () => {
          generateFor(withTwoBlanks(at(k++)), lexicon);
        }).run({ ...options, iterations: POSITIONS });
        report[kind] = latency(plain);
        report[`${kind}TwoBlanks`] = latency(blanks);
      }
      console.log(`Q-A2 time ${JSON.stringify(report)}`);
    });
  });
}
