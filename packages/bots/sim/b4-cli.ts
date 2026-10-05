/**
 * B4 readout CLI (`pnpm --filter @codelex/bots simulate:b4 -- --job <id> [options]`): one job of the B4 job table
 * (`b4.ts`) on `engineRulesVersion` 1, every match replayed to identical hashes, written as a JSON report. Not part
 * of `pnpm test`; the readout is docs/game/sim/2026-10-b4-strategist/.
 *
 * Options:
 *   --job <id>            st1b, st2, st3, st7-strategist, st7-greedy, bg5, st1, st1-f0
 *   --matches <n>         override the job's match count (tuning iterations)
 *   --strategist <json>   simulator-only override of the Strategist data under test, e.g.
 *                         '{"topWeights":[16,6,2,1],"strategy":{"chainKeepDp":40}}' (tuning seeds only)
 *   --recheck <n>         replays the first n matches a second time and requires equal final hashes (ST-6)
 *   --out <file>          JSON report (default sim-results/b4-<job>.json)
 *
 * The only use of the process is reading explicit arguments (`argv`): no environment, no clock.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { argv } from 'node:process';
import type { LexiconIndex } from '@codelex/lexicon/index';
import { PERSONALITIES } from '../src/index.js';
import { STRATEGIST_STRATEGY } from '../src/personalities.js';
import type { PersonalityData, StrategyData } from '../src/types.js';
import { jobReport, jobsFor, runJob, type LexiconId } from './b4.js';
import { toJson } from './report.js';
import { mainLexicon } from './b4-play.js';

interface Patch {
  readonly topWeights?: readonly number[];
  readonly maxDifficultyRank?: 0 | 1 | 2 | 3;
  readonly strategy?: Partial<StrategyData>;
}

export function strategistData(patch: Patch): PersonalityData {
  const base = PERSONALITIES.strategist;
  return {
    ...base,
    ...(patch.topWeights === undefined ? {} : { topWeights: patch.topWeights }),
    ...(patch.maxDifficultyRank === undefined
      ? {}
      : { maxDifficultyRank: patch.maxDifficultyRank }),
    strategy: { ...STRATEGIST_STRATEGY, ...(patch.strategy ?? {}) },
  };
}

function lexiconFor(id: LexiconId): LexiconIndex {
  return mainLexicon(id === 'main-f1');
}

function main(): void {
  const args = argv.slice(2)[0] === '--' ? argv.slice(3) : argv.slice(2);
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) flags.set(args[i] ?? '', args[i + 1] ?? '');
  const patchText = flags.get('--strategist');
  const patch = patchText === undefined ? {} : (JSON.parse(patchText) as Patch);
  const job = jobsFor(strategistData(patch)).find((j) => j.id === flags.get('--job'));
  if (job === undefined) throw new Error('--job: unknown job id');
  const matchesText = flags.get('--matches');
  const matches = matchesText === undefined ? job.matches : Number.parseInt(matchesText, 10);
  const lexicon = lexiconFor(job.lexicon);
  const records = runJob(job, lexicon, 0, matches, (i) => {
    if ((i + 1) % 500 === 0) console.log(`${job.id}: ${String(i + 1)} matches`);
  });
  const recheck = Number.parseInt(flags.get('--recheck') ?? '0', 10);
  const again = runJob(job, lexicon, 0, Math.min(recheck, matches));
  const deterministic = again.every((r, i) => r.finalHash === records[i]?.finalHash);
  if (!deterministic) throw new Error('ST-6: a re-run produced a different final hash');
  const report = {
    ...jobReport({ ...job, matches }, lexicon, job.lexicon, records),
    strategistPatch: patchText ?? '{}',
    determinismRecheck: again.length,
  };
  const out = resolve(flags.get('--out') ?? `sim-results/b4-${job.id}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, toJson(report));
  console.log(`wrote ${out}`);
}

main();
