/**
 * `readout --merge` (v2-balance-check §5.3-2): when the runner time limit forces the variants into separate jobs
 * with identical inputs, this joins their results JSON into one suite report and computes the single V1 readout.
 *
 * Every input is parsed with zod (trust boundary: files from CI artefacts). Inputs must share the run inputs
 * (master seed, code commit, lexicon commit, pre-registration blob, `BOT_VERSION`, primary bot, Strategist
 * budget). No variant may appear twice, and together the inputs must cover the gating variants `v1`, `v2-3612`
 * and `v2-248`. Each job's own readout is ignored except for its primary bot and provenance: the merged report is
 * re-evaluated from the suite data.
 */
import { z } from 'zod';
import { BALANCE_VARIANTS } from './balance-check.js';
import { readout, type Readout, type ReadoutOptions, type RunProvenance } from './readout.js';
import type { SuiteReport } from './simulate.js';

export type MergeErrorCode =
  | 'NO_INPUT'
  | 'MALFORMED'
  | 'SCHEMA'
  | 'MISMATCH_SEED'
  | 'MISMATCH_BOT_VERSION'
  | 'MISMATCH_CODE_COMMIT'
  | 'MISMATCH_LEXICON_COMMIT'
  | 'MISMATCH_PREREG_BLOB'
  | 'MISMATCH_PRIMARY'
  | 'MISMATCH_STRATEGIST_BUDGET'
  | 'DUPLICATE_VARIANT'
  | 'MISSING_VARIANT';

export class MergeError extends Error {
  constructor(
    readonly code: MergeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MergeError';
  }
}

// --- schema (mirrors simulate.ts / stats.ts / rules.ts; strict: an unknown key is a format drift) ---

const int = z.int();
const interval = z.strictObject({ lo: int, hi: int });
const spread = z.strictObject({ p50: int, p95: int, max: int });
const rate = z.strictObject({ k: int, n: int, bp: int, ci95: interval });
const budget = z.strictObject({ maxNodes: int, maxCandidates: int });

const personality = z.strictObject({
  personality: z.string(),
  decisions: int,
  placeWord: int,
  placeWordPoints: int,
  exchange: int,
  pass: int,
  noWordBp: int,
  budgetExhausted: int,
  budgetExhaustedBp: int,
  fallbacksAfterEvaluation: int,
  candidatesRefused: int,
  nodes: spread,
  candidatesEvaluated: spread,
  pointsPerWordTenths: int,
  noviceOrIntermediateBp: int,
  meanScoreTenths: int,
});

const pairing = z.strictObject({
  id: z.string(),
  index: int,
  a: z.string(),
  b: z.string(),
  matches: int,
  draws: int,
  firstPlayerWin: rate,
  aWin: rate,
  endReasons: z.strictObject({ going_out: int, scoreless_turns: int, resign: int }),
  scorelessEndingBp: int,
  noWordTurnBp: int,
  noWordTurnBagNotEmptyBp: int,
  bagEmptyAtEndBp: int,
  bagAtEnd: z.strictObject({ empty: int, oneToSix: int, sevenPlus: int, spread }),
  prematureLock: rate,
  tilesPlayed: z.strictObject({ n: int, meanTenths: int, ci95: interval }),
  passesPerMatch: spread,
  matchesWithPass: int,
  rackTilesAtEnd: spread,
  meanTotalScoreTenths: int,
  meanFirstMoverLeadTenths: int,
  wordsPerMatchTenths: int,
  actionsPerMatch: spread,
  top20TermShareBp: int,
  distinctTermsPlayed: int,
  inflectionShareBp: int,
  termBonusShareBp: int,
  termBonusShare: z.strictObject({ n: int, bp: int, ci95: interval }),
  hookTermBonusShareBp: int,
  personalities: z.array(personality),
  replayVerified: int,
});

const variant = z.strictObject({
  id: z.string(),
  lexiconVersion: z.string(),
  profileId: z.string(),
  definitionHash: z.string(),
  forms: int,
  terms: int,
  automaton: z.enum(['gaddag', 'dawg']),
  rules: z.strictObject({
    engineRulesVersion: int,
    status: z.enum(['frozen', 'draft']),
    gameRules: z.string(),
    candidate: z.string(),
    layout: z.string(),
    letters: z.string(),
    termBonus: z.array(int),
    rulesDigest: z.string(),
  }),
  pairings: z.array(pairing),
});

const suite = z.strictObject({
  botVersion: int,
  engineRulesVersions: z.array(int),
  strategistBudget: budget.nullable(),
  masterSeed: z.string(),
  matches: int,
  variants: z.array(variant),
});

const results = z.object({
  readout: z.object({
    primary: z.string(),
    provenance: z.strictObject({
      codeCommit: z.string(),
      lexiconCommit: z.string(),
      preRegistrationBlob: z.string(),
    }),
  }),
  suite,
});

interface Job {
  readonly primary: string;
  readonly provenance: RunProvenance;
  readonly suite: SuiteReport;
}

function parseJob(text: string, position: number): Job {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new MergeError('MALFORMED', `input ${String(position + 1)}: not JSON`);
  }
  const parsed = results.safeParse(raw);
  if (!parsed.success) {
    const where = parsed.error.issues[0]?.path.join('.') ?? '';
    throw new MergeError(
      'SCHEMA',
      `input ${String(position + 1)}: not a results JSON (at ${where})`,
    );
  }
  return {
    primary: parsed.data.readout.primary,
    provenance: parsed.data.readout.provenance,
    suite: parsed.data.suite,
  };
}

function sameBudget(
  a: SuiteReport['strategistBudget'],
  b: SuiteReport['strategistBudget'],
): boolean {
  if (a === null || b === null) return a === b;
  return a.maxNodes === b.maxNodes && a.maxCandidates === b.maxCandidates;
}

export interface MergedRun {
  readonly primary: string;
  readonly provenance: RunProvenance;
  readonly suite: SuiteReport;
  /** The single V1 readout of the merged suite. */
  readonly readout: (
    wallTimeSeconds?: number | null,
    expected?: ReadoutOptions['expected'],
  ) => Readout;
}

/** Joins split jobs (results JSON texts) into one suite; throws `MergeError` on any inconsistency. */
export function mergeResults(texts: readonly string[]): MergedRun {
  if (texts.length === 0) throw new MergeError('NO_INPUT', 'no results JSON given');
  const jobs = texts.map(parseJob);
  const [first] = jobs;
  if (first === undefined) throw new MergeError('NO_INPUT', 'no results JSON given');
  const checks: readonly [MergeErrorCode, string, (j: Job) => unknown][] = [
    ['MISMATCH_SEED', 'master seed', (j) => j.suite.masterSeed],
    ['MISMATCH_BOT_VERSION', 'BOT_VERSION', (j) => j.suite.botVersion],
    ['MISMATCH_CODE_COMMIT', 'code commit', (j) => j.provenance.codeCommit],
    ['MISMATCH_LEXICON_COMMIT', 'lexicon commit', (j) => j.provenance.lexiconCommit],
    ['MISMATCH_PREREG_BLOB', 'pre-registration blob', (j) => j.provenance.preRegistrationBlob],
    ['MISMATCH_PRIMARY', 'primary bot', (j) => j.primary],
  ];
  jobs.forEach((job, i) => {
    for (const [code, name, of] of checks) {
      if (of(job) !== of(first)) {
        throw new MergeError(code, `input ${String(i + 1)}: ${name} differs from input 1`);
      }
    }
    if (!sameBudget(job.suite.strategistBudget, first.suite.strategistBudget)) {
      throw new MergeError(
        'MISMATCH_STRATEGIST_BUDGET',
        `input ${String(i + 1)}: Strategist budget differs from input 1`,
      );
    }
  });
  const variants = jobs.flatMap((j) => j.suite.variants);
  const seen = new Set<string>();
  for (const v of variants) {
    if (seen.has(v.id)) throw new MergeError('DUPLICATE_VARIANT', `variant ${v.id} appears twice`);
    seen.add(v.id);
  }
  for (const def of BALANCE_VARIANTS) {
    if (def.role !== 'diagnostic' && !seen.has(def.id)) {
      throw new MergeError('MISSING_VARIANT', `gating variant ${def.id} is in no input`);
    }
  }
  const order = (id: string): number => {
    const i = BALANCE_VARIANTS.findIndex((d) => d.id === id);
    return i < 0 ? BALANCE_VARIANTS.length : i;
  };
  const sorted = [...variants].sort((x, y) => order(x.id) - order(y.id) || (x.id < y.id ? -1 : 1));
  const merged: SuiteReport = {
    botVersion: first.suite.botVersion,
    engineRulesVersions: [...new Set(sorted.map((v) => v.rules.engineRulesVersion))].sort(
      (x, y) => x - y,
    ),
    strategistBudget: first.suite.strategistBudget,
    masterSeed: first.suite.masterSeed,
    matches: jobs.reduce((a, j) => a + j.suite.matches, 0),
    variants: sorted,
  };
  return {
    primary: first.primary,
    provenance: first.provenance,
    suite: merged,
    readout: (wallTimeSeconds = null, expected = {}) =>
      readout(merged, first.primary, first.provenance, {
        ...(wallTimeSeconds === null ? {} : { wallTimeSeconds }),
        expected,
      }),
  };
}

export interface MergeArgs {
  readonly inputs: readonly string[];
  readonly out: string;
  readonly markdown: string;
  readonly wallTimeSeconds: number | null;
  readonly expected: { lexiconVersion?: string; definitionHash?: string };
}

/**
 * `--merge <json…> [--out f] [--markdown f] [--wall-time-s n] [--lexicon-version v] [--definition-hash h]`.
 * `--merge` takes every following argument up to the next `--flag`.
 */
export function parseMergeArgs(args: readonly string[]): MergeArgs {
  const rest = args[0] === '--' ? args.slice(1) : args;
  const inputs: string[] = [];
  let out = 'sim-results/balance-check-results.json';
  let markdown = 'sim-results/balance-check-readout.md';
  let wallTimeSeconds: number | null = null;
  const expected: { lexiconVersion?: string; definitionHash?: string } = {};
  let merge = false;
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i] ?? '';
    if (flag === '--merge') {
      merge = true;
      while (i + 1 < rest.length && !(rest[i + 1] ?? '').startsWith('--')) {
        inputs.push(rest[i + 1] ?? '');
        i += 1;
      }
      continue;
    }
    const value = rest[i + 1];
    if (value === undefined) throw new Error(`${flag}: missing value`);
    i += 1;
    switch (flag) {
      case '--out':
        out = value;
        break;
      case '--markdown':
        markdown = value;
        break;
      case '--wall-time-s':
        if (!/^[0-9]{1,7}$/.test(value)) throw new Error('--wall-time-s: whole seconds');
        wallTimeSeconds = Number.parseInt(value, 10);
        break;
      case '--lexicon-version':
        expected.lexiconVersion = value;
        break;
      case '--definition-hash':
        if (!/^[0-9a-f]{16}$/.test(value))
          throw new Error('--definition-hash: 16 lowercase hex chars');
        expected.definitionHash = value;
        break;
      default:
        throw new Error(`unknown option ${flag}`);
    }
  }
  if (!merge || inputs.length === 0) throw new Error('--merge: one or more results JSON files');
  return { inputs, out, markdown, wallTimeSeconds, expected };
}
