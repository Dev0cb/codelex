/**
 * V1 readout (docs/specs/E-1.6-balance/v2-balance-check.md §3–§5): turns a suite report into the pre-registered
 * criteria, per-criterion verdicts and the §5.1 outcome, mechanically (§5.3-3). Integers only: values, bounds and
 * thresholds are basis points or tenths exactly as emitted by the simulator (§3.2: thresholds inclusive, no
 * re-rounding).
 *
 * - Gating criteria P-1..P-6, S-1, B-07, BG-1, BG-2a, BG-3, BG-4, BG-5 (§3.4) with their classes R/L/K.
 * - L/K excuse (§3.3): a candidate's L or K FAIL becomes EXCUSED-L / EXCUSED-K iff `v1` FAILs the same criterion.
 * - Not measured counts as FAIL (§3.3), except B-07 on the Strategist-late path (§5.2), which labels the
 *   decision provisional.
 * - Integrity I-1..I-3: any failure makes the run INVALID (§5.4 b), never a candidate FAIL, and then no variant
 *   gets a pass/fail. A smoke run (other seed, smaller counts, missing commits) is INVALID by I-3 and yields no
 *   decision. `BOT_VERSION` must be 2 with Strategist as primary; on the §5.2 greedy path 1 or 2 is accepted
 *   and recorded (pre-run clarification of 2026-10-05, v2-balance-check §5.2).
 * - I-2 counts engine refusals (`candidatesRefused`) for every bot. Voluntary exchanges are not refusals, so
 *   Strategist's pairings 0 and 2 are covered as well.
 * - Reported, never gating: BG-2b, the bag-at-end split, draws, and paired point differences on shared seeds.
 */
import {
  BALANCE_VARIANTS,
  PRE_REGISTRATION,
  STRATEGIST,
  type VariantRole,
} from './balance-check.js';
import type { PairingReport, PersonalityStats, SuiteReport, VariantReport } from './simulate.js';
import { fixed, pct, roundDiv } from './stats.js';

export type CriterionClass = 'R' | 'L' | 'K';
export type Verdict = 'PASS' | 'FAIL' | 'EXCUSED-L' | 'EXCUSED-K' | 'NOT-MEASURED';
type Raw = 'PASS' | 'FAIL' | 'NOT-MEASURED';

interface Measure {
  readonly value: number;
  readonly lo: number | null;
  readonly hi: number | null;
}

interface CriterionDef {
  readonly id: string;
  readonly metric: string;
  readonly pairings: readonly number[];
  readonly cls: CriterionClass;
  readonly unit: 'bp' | 'tenths';
  readonly rule: string;
  /** P-1..P-6 run on diagnostics too (primary pairing only). */
  readonly primaryOnly: boolean;
  readonly measure: (v: VariantReport) => Measure | undefined;
  readonly pass: (m: Measure) => boolean;
}

export interface CriterionResult {
  readonly id: string;
  readonly metric: string;
  readonly pairings: readonly number[];
  readonly class: CriterionClass;
  readonly unit: 'bp' | 'tenths';
  readonly value: number | null;
  readonly lo: number | null;
  readonly hi: number | null;
  readonly rule: string;
  readonly verdict: Verdict;
}

export interface IntegrityResult {
  readonly id: 'I-1' | 'I-2' | 'I-3';
  readonly holds: boolean;
  readonly problems: readonly string[];
}

export interface VariantReadout {
  readonly id: string;
  readonly role: VariantRole | 'unregistered';
  readonly engineRulesVersion: number;
  readonly candidate: string;
  readonly layout: string;
  readonly rulesDigest: string;
  readonly criteria: readonly CriterionResult[];
  /** Candidates and the baseline: §3.4 pass; diagnostics: null (never gating). */
  readonly passes: boolean | null;
  readonly blocking: readonly string[];
  readonly reported: ReportedMetrics | null;
}

export interface ReportedMetrics {
  readonly draws: number;
  readonly noWordTurnAllBp: number;
  readonly bagAtEnd: {
    readonly empty: number;
    readonly oneToSix: number;
    readonly sevenPlus: number;
  };
  readonly matchesWithPass: number;
  readonly c11CiLoTenths: number;
  readonly c11CiHiTenths: number;
  readonly c05CiLoBp: number;
  readonly firstMoverLeadTenths: number;
  readonly pointsPerWordTenths: number;
  readonly inflectionShareBp: number;
  readonly hookTermBonusShareBp: number;
  /** BG-2b: full-vocabulary greedy vs Beginner (pairing 5), reported only. */
  readonly bg2bBp: number | null;
}

export interface PairedDifference {
  readonly a: string;
  readonly b: string;
  readonly metric: string;
  readonly unit: 'bp' | 'tenths';
  /** a − b, point estimates on pairing 0. Exactly paired between the candidates only (§3.4). */
  readonly diff: number;
}

export interface RunProvenance {
  readonly codeCommit: string;
  readonly lexiconCommit: string;
  readonly preRegistrationBlob: string;
}

/** §6 run-level fields. */
export interface RunFields {
  /** Distinct `engineRulesVersion`s of the variants that ran, ascending. */
  readonly engineRulesVersions: readonly number[];
  readonly strategistBudget: { readonly maxNodes: number; readonly maxCandidates: number } | null;
  /** Measured by the workflow (no clock in the package, ADR-0013 §D4.6); null when not supplied. */
  readonly wallTimeSeconds: number | null;
  /** The lexicon every variant ran on (I-3 checks they agree). */
  readonly lexiconVersion: string;
  readonly profileId: string;
  readonly definitionHash: string;
}

export interface ReadoutOptions {
  readonly wallTimeSeconds?: number;
  /** §4.3 values recorded by the workflow for the lexicon commit; when given, I-3 compares every variant. */
  readonly expected?: { readonly lexiconVersion?: string; readonly definitionHash?: string };
}

export interface Readout {
  readonly preRegistration: string;
  readonly masterSeed: string;
  readonly botVersion: number;
  readonly primary: string;
  readonly provisional: boolean;
  readonly provenance: RunProvenance;
  readonly run: RunFields;
  readonly integrity: readonly IntegrityResult[];
  readonly valid: boolean;
  readonly variants: readonly VariantReadout[];
  readonly pairedDifferences: readonly PairedDifference[];
  readonly outcome: { readonly decision: string; readonly path: readonly string[] };
}

// --- criteria (§3.4) ---

function pairing(v: VariantReport, index: number): PairingReport | undefined {
  return v.pairings.find((p) => p.index === index);
}

function stats(p: PairingReport | undefined, bot: string): PersonalityStats | undefined {
  return p?.personalities.find((s) => s.personality === bot);
}

function point(value: number): Measure {
  return { value, lo: null, hi: null };
}

function aWinRate(index: number) {
  return (v: VariantReport): Measure | undefined => {
    const p = pairing(v, index);
    if (p === undefined || p.aWin.n === 0) return undefined;
    return { value: p.aWin.bp, lo: p.aWin.ci95.lo, hi: p.aWin.ci95.hi };
  };
}

function firstPlayer(index: number) {
  return (v: VariantReport): Measure | undefined => {
    const p = pairing(v, index);
    if (p === undefined || p.firstPlayerWin.n === 0) return undefined;
    const r = p.firstPlayerWin;
    return { value: r.bp, lo: r.ci95.lo, hi: r.ci95.hi };
  };
}

function primary(f: (p: PairingReport) => Measure | undefined) {
  return (v: VariantReport): Measure | undefined => {
    const p = pairing(v, 0);
    return p === undefined || p.matches === 0 ? undefined : f(p);
  };
}

/** BG-3: (Σ Beginner points / Σ Beginner words) ÷ (Σ greedy points / Σ greedy words), bp, from the raw sums. */
function ppwRatio(v: VariantReport): Measure | undefined {
  const p = pairing(v, 5);
  const beginner = stats(p, 'beginner');
  const greedy = stats(p, 'greedy');
  if (beginner === undefined || greedy === undefined) return undefined;
  const num = beginner.placeWordPoints * greedy.placeWord;
  const den = beginner.placeWord * greedy.placeWordPoints;
  if (den === 0 || !Number.isSafeInteger(10_000 * num)) return undefined;
  return point(roundDiv(10_000 * num, den));
}

/** BG-5: Beginner `budgetExhausted` decisions pooled over pairings 1, 3, 4, 5 (all four required). */
function beginnerBudget(v: VariantReport): Measure | undefined {
  let exhausted = 0;
  let decisions = 0;
  for (const index of [1, 3, 4, 5]) {
    const s = stats(pairing(v, index), 'beginner');
    if (s === undefined) return undefined;
    exhausted += s.budgetExhausted;
    decisions += s.decisions;
  }
  return decisions === 0 ? undefined : point(roundDiv(10_000 * exhausted, decisions));
}

const CRITERIA: readonly CriterionDef[] = [
  {
    id: 'P-1',
    metric: 'B-01 first-player win rate (draws excluded)',
    pairings: [0],
    cls: 'R',
    unit: 'bp',
    rule: 'CI within [4800, 5200]',
    primaryOnly: true,
    measure: firstPlayer(0),
    pass: (m) => (m.lo ?? 0) >= 4800 && (m.hi ?? 10_000) <= 5200,
  },
  {
    id: 'P-2',
    metric: 'C-05 term-bonus share of PlaceWord points',
    pairings: [0],
    cls: 'R',
    unit: 'bp',
    rule: 'upper CI <= 3500',
    primaryOnly: true,
    measure: primary((p) =>
      p.termBonusShare.n < 2
        ? undefined
        : {
            value: p.termBonusShare.bp,
            lo: p.termBonusShare.ci95.lo,
            hi: p.termBonusShare.ci95.hi,
          },
    ),
    pass: (m) => (m.hi ?? 10_000) <= 3500,
  },
  {
    id: 'P-3',
    metric: 'C-02 no-PlaceWord turns, bag not empty',
    pairings: [0],
    cls: 'L',
    unit: 'bp',
    rule: 'point <= 1500',
    primaryOnly: true,
    measure: primary((p) => point(p.noWordTurnBagNotEmptyBp)),
    pass: (m) => m.value <= 1500,
  },
  {
    id: 'P-4',
    metric: 'C-10 R-TURN-004 endings with bag >= 7',
    pairings: [0],
    cls: 'L',
    unit: 'bp',
    rule: 'point <= 500',
    primaryOnly: true,
    measure: primary((p) => point(p.prematureLock.bp)),
    pass: (m) => m.value <= 500,
  },
  {
    id: 'P-5',
    metric: 'C-11 mean tiles played per match',
    pairings: [0],
    cls: 'L',
    unit: 'tenths',
    rule: 'point >= 900',
    primaryOnly: true,
    measure: primary((p) => ({
      value: p.tilesPlayed.meanTenths,
      lo: p.tilesPlayed.ci95.lo,
      hi: p.tilesPlayed.ci95.hi,
    })),
    pass: (m) => m.value >= 900,
  },
  {
    id: 'P-6',
    metric: 'Top-20 terms share of main words',
    pairings: [0],
    cls: 'L',
    unit: 'bp',
    rule: 'point <= 4000',
    primaryOnly: true,
    measure: primary((p) => point(p.top20TermShareBp)),
    pass: (m) => m.value <= 4000,
  },
  {
    id: 'S-1',
    metric: 'B-01 first-player win rate, Beginner mirror',
    pairings: [1],
    cls: 'R',
    unit: 'bp',
    rule: 'FAIL if lo > 5200 or hi < 4800',
    primaryOnly: false,
    measure: firstPlayer(1),
    pass: (m) => !((m.lo ?? 0) > 5200 || (m.hi ?? 10_000) < 4800),
  },
  {
    id: 'B-07',
    metric: 'Strategist win rate vs Beginner (draws excluded)',
    pairings: [2],
    cls: 'K',
    unit: 'bp',
    rule: 'lower CI >= 6000',
    primaryOnly: false,
    measure: aWinRate(2),
    pass: (m) => (m.lo ?? 0) >= 6000,
  },
  {
    id: 'BG-1',
    metric: 'Beginner win rate vs random-legal',
    pairings: [3],
    cls: 'K',
    unit: 'bp',
    rule: 'point >= 8000',
    primaryOnly: false,
    measure: aWinRate(3),
    pass: (m) => m.value >= 8000,
  },
  {
    id: 'BG-2a',
    metric: 'Vocabulary-matched greedy win rate vs Beginner',
    pairings: [4],
    cls: 'K',
    unit: 'bp',
    rule: 'point in [6500, 8500]',
    primaryOnly: false,
    measure: aWinRate(4),
    pass: (m) => m.value >= 6500 && m.value <= 8500,
  },
  {
    id: 'BG-3',
    metric: 'Beginner points per word / full greedy points per word',
    pairings: [5],
    cls: 'K',
    unit: 'bp',
    rule: 'point in [5500, 7500]',
    primaryOnly: false,
    measure: ppwRatio,
    pass: (m) => m.value >= 5500 && m.value <= 7500,
  },
  {
    id: 'BG-4',
    metric: 'Beginner main words novice or intermediate',
    pairings: [5],
    cls: 'K',
    unit: 'bp',
    rule: 'point >= 9000',
    primaryOnly: false,
    measure: (v) => {
      const s = stats(pairing(v, 5), 'beginner');
      return s === undefined || s.placeWord === 0 ? undefined : point(s.noviceOrIntermediateBp);
    },
    pass: (m) => m.value >= 9000,
  },
  {
    id: 'BG-5',
    metric: 'Beginner budgetExhausted decisions',
    pairings: [1, 3, 4, 5],
    cls: 'K',
    unit: 'bp',
    rule: 'point <= 100',
    primaryOnly: false,
    measure: beginnerBudget,
    pass: (m) => m.value <= 100,
  },
];

function evaluateRaw(def: CriterionDef, v: VariantReport): { m: Measure | undefined; raw: Raw } {
  const m = def.measure(v);
  if (m === undefined) return { m, raw: 'NOT-MEASURED' };
  return { m, raw: def.pass(m) ? 'PASS' : 'FAIL' };
}

// --- integrity (§3.4 I-1..I-3, §6) ---

const SHA = /^[0-9a-f]{40}$/;

/** Accepted `BOT_VERSION`s: 2 with Strategist; 1 or 2 on the §5.2 greedy path (clarification 2026-10-05). */
function botVersionsFor(primaryBot: string): readonly number[] {
  return primaryBot === STRATEGIST
    ? [PRE_REGISTRATION.botVersion]
    : [1, PRE_REGISTRATION.botVersion];
}

function lexiconChecks(report: SuiteReport, options: ReadoutOptions): string[] {
  const problems: string[] = [];
  const first = report.variants[0];
  for (const v of report.variants) {
    if (v.profileId !== PRE_REGISTRATION.profileId) {
      problems.push(
        `variant ${v.id}: profile ${v.profileId}, pre-registered ${PRE_REGISTRATION.profileId}`,
      );
    }
    if (
      first !== undefined &&
      (v.lexiconVersion !== first.lexiconVersion || v.definitionHash !== first.definitionHash)
    ) {
      problems.push(`variant ${v.id}: lexicon differs between variants (§4.3: one lexicon commit)`);
    }
    const want = options.expected;
    if (want?.lexiconVersion !== undefined && v.lexiconVersion !== want.lexiconVersion) {
      problems.push(
        `variant ${v.id}: lexiconVersion ${v.lexiconVersion}, expected ${want.lexiconVersion}`,
      );
    }
    if (want?.definitionHash !== undefined && v.definitionHash !== want.definitionHash) {
      problems.push(
        `variant ${v.id}: definitionHash ${v.definitionHash}, expected ${want.definitionHash}`,
      );
    }
  }
  return problems;
}

function integrity(
  report: SuiteReport,
  primaryBot: string,
  provenance: RunProvenance,
  options: ReadoutOptions,
): IntegrityResult[] {
  const i1: string[] = [];
  const i2: string[] = [];
  const i3: string[] = [];
  for (const v of report.variants) {
    for (const p of v.pairings) {
      if (p.replayVerified !== p.matches)
        i1.push(`${v.id}/${p.id}: replay ${String(p.replayVerified)}/${String(p.matches)}`);
      for (const s of p.personalities) {
        if (s.candidatesRefused > 0) {
          i2.push(
            `${v.id}/${p.id}: ${s.personality}: ${String(s.candidatesRefused)} engine refusal(s) of evaluated candidates`,
          );
        }
      }
    }
  }
  if (report.masterSeed !== PRE_REGISTRATION.masterSeed) {
    i3.push(`master seed ${report.masterSeed}, pre-registered ${PRE_REGISTRATION.masterSeed}`);
  }
  if (!botVersionsFor(primaryBot).includes(report.botVersion)) {
    i3.push(
      `BOT_VERSION ${String(report.botVersion)}, pre-registered ${botVersionsFor(primaryBot).join(' or ')}`,
    );
  }
  i3.push(...lexiconChecks(report, options));
  if (primaryBot !== STRATEGIST && primaryBot !== 'greedy') i3.push(`primary bot ${primaryBot}`);
  for (const [name, value] of [
    ['code commit', provenance.codeCommit],
    ['lexicon commit', provenance.lexiconCommit],
    ['pre-registration blob', provenance.preRegistrationBlob],
  ] as const) {
    if (!SHA.test(value)) i3.push(`${name} missing (40 hex chars expected)`);
  }
  for (const def of BALANCE_VARIANTS) {
    const v = report.variants.find((x) => x.id === def.id);
    if (v === undefined) {
      if (def.role !== 'diagnostic') i3.push(`variant ${def.id} missing`);
      continue;
    }
    const expected = def.rules;
    if (
      v.rules.engineRulesVersion !== expected.engineRulesVersion ||
      v.rules.candidate !== (expected.candidate ?? 'none') ||
      v.rules.layout !== expected.layout ||
      v.rules.letters !== expected.letters
    ) {
      i3.push(`variant ${def.id}: rules differ from §2`);
    }
    const indices =
      def.role === 'diagnostic'
        ? [0]
        : primaryBot === STRATEGIST
          ? [0, 1, 2, 3, 4, 5]
          : [0, 1, 3, 4, 5];
    for (const index of indices) {
      const p = pairing(v, index);
      const want = index <= 1 ? PRE_REGISTRATION.mirrorMatches : PRE_REGISTRATION.pairMatches;
      if (p === undefined) i3.push(`variant ${def.id}: pairing ${String(index)} missing`);
      else if (p.matches !== want) {
        i3.push(
          `variant ${def.id}: pairing ${String(index)} has ${String(p.matches)} matches, pre-registered ${String(want)}`,
        );
      }
    }
  }
  for (const v of report.variants) {
    if (!BALANCE_VARIANTS.some((d) => d.id === v.id))
      i3.push(`variant ${v.id} is not pre-registered`);
  }
  return [
    { id: 'I-1', holds: i1.length === 0, problems: i1 },
    { id: 'I-2', holds: i2.length === 0, problems: i2 },
    { id: 'I-3', holds: i3.length === 0, problems: i3 },
  ];
}

// --- readout ---

function reported(v: VariantReport): ReportedMetrics | null {
  const p = pairing(v, 0);
  if (p === undefined) return null;
  const words = p.personalities.reduce((a, s) => a + s.placeWord, 0);
  const points = p.personalities.reduce((a, s) => a + s.placeWordPoints, 0);
  const bg2b = pairing(v, 5);
  return {
    draws: p.draws,
    noWordTurnAllBp: p.noWordTurnBp,
    bagAtEnd: {
      empty: p.bagAtEnd.empty,
      oneToSix: p.bagAtEnd.oneToSix,
      sevenPlus: p.bagAtEnd.sevenPlus,
    },
    matchesWithPass: p.matchesWithPass,
    c11CiLoTenths: p.tilesPlayed.ci95.lo,
    c11CiHiTenths: p.tilesPlayed.ci95.hi,
    c05CiLoBp: p.termBonusShare.ci95.lo,
    firstMoverLeadTenths: p.meanFirstMoverLeadTenths,
    pointsPerWordTenths: words === 0 ? 0 : roundDiv(10 * points, words),
    inflectionShareBp: p.inflectionShareBp,
    hookTermBonusShareBp: p.hookTermBonusShareBp,
    bg2bBp: bg2b === undefined || bg2b.aWin.n === 0 ? null : bg2b.aWin.bp,
  };
}

const DIFF_METRICS: readonly {
  readonly metric: string;
  readonly unit: 'bp' | 'tenths';
  readonly of: (p: PairingReport) => number;
}[] = [
  { metric: 'B-01', unit: 'bp', of: (p) => p.firstPlayerWin.bp },
  { metric: 'C-05', unit: 'bp', of: (p) => p.termBonusShare.bp },
  { metric: 'C-02', unit: 'bp', of: (p) => p.noWordTurnBagNotEmptyBp },
  { metric: 'C-10', unit: 'bp', of: (p) => p.prematureLock.bp },
  { metric: 'C-11', unit: 'tenths', of: (p) => p.tilesPlayed.meanTenths },
  { metric: 'top-20', unit: 'bp', of: (p) => p.top20TermShareBp },
];

function pairedDifferences(report: SuiteReport): PairedDifference[] {
  const pairs: [string, string][] = [
    ['v2-3612', 'v2-248'],
    ['v2-3612', 'v1'],
    ['v2-248', 'v1'],
    ['v2-3612', 'dx-dw-3612'],
    ['v2-248', 'dx-dw-248'],
  ];
  const out: PairedDifference[] = [];
  for (const [a, b] of pairs) {
    const pa = report.variants.find((v) => v.id === a);
    const pb = report.variants.find((v) => v.id === b);
    const p0a = pa === undefined ? undefined : pairing(pa, 0);
    const p0b = pb === undefined ? undefined : pairing(pb, 0);
    if (p0a === undefined || p0b === undefined) continue;
    for (const d of DIFF_METRICS)
      out.push({ a, b, metric: d.metric, unit: d.unit, diff: d.of(p0a) - d.of(p0b) });
  }
  return out;
}

function toResult(def: CriterionDef, m: Measure | undefined, verdict: Verdict): CriterionResult {
  return {
    id: def.id,
    metric: def.metric,
    pairings: def.pairings,
    class: def.cls,
    unit: def.unit,
    value: m?.value ?? null,
    lo: m?.lo ?? null,
    hi: m?.hi ?? null,
    rule: def.rule,
    verdict,
  };
}

/**
 * The V1 readout of a balance-check suite report. `primary` is the pairing-0 bot the run used (`strategist`, or
 * `greedy` on the §5.2 path); `provenance` comes from the workflow inputs (§6).
 */
export function readout(
  report: SuiteReport,
  primaryBot: string,
  provenance: RunProvenance,
  options: ReadoutOptions = {},
): Readout {
  const provisional = primaryBot !== STRATEGIST;
  const checks = integrity(report, primaryBot, provenance, options);
  const valid = checks.every((c) => c.holds);
  const baseline = report.variants.find((v) => v.id === 'v1');
  // §3.3: a criterion v1 did not measure counts as a v1 FAIL (for the L/K excuse too).
  const baselineRaw = new Map<string, Raw>();
  if (baseline !== undefined)
    for (const def of CRITERIA) baselineRaw.set(def.id, evaluateRaw(def, baseline).raw);

  const variants = report.variants.map((v): VariantReadout => {
    const role = BALANCE_VARIANTS.find((d) => d.id === v.id)?.role ?? 'unregistered';
    const defs = role === 'diagnostic' ? CRITERIA.filter((d) => d.primaryOnly) : CRITERIA;
    const blocking: string[] = [];
    const criteria = defs.map((def) => {
      const { m, raw } = evaluateRaw(def, v);
      let verdict: Verdict = raw;
      if (
        role === 'candidate' &&
        raw === 'FAIL' &&
        def.cls !== 'R' &&
        baselineRaw.get(def.id) !== undefined &&
        baselineRaw.get(def.id) !== 'PASS'
      ) {
        verdict = def.cls === 'L' ? 'EXCUSED-L' : 'EXCUSED-K';
      }
      const excusedLate = verdict === 'NOT-MEASURED' && def.id === 'B-07' && provisional;
      if (verdict === 'FAIL' || (verdict === 'NOT-MEASURED' && !excusedLate)) blocking.push(def.id);
      return toResult(def, m, verdict);
    });
    return {
      id: v.id,
      role,
      engineRulesVersion: v.rules.engineRulesVersion,
      candidate: v.rules.candidate,
      layout: v.rules.layout,
      rulesDigest: v.rules.rulesDigest,
      criteria,
      // No pass/fail on an INVALID run (§5.4 b): it would read as evidence.
      passes:
        !valid || role === 'diagnostic' || role === 'unregistered' ? null : blocking.length === 0,
      blocking,
      reported: reported(v),
    };
  });

  const path: string[] = [];
  let decision: string;
  if (!valid) {
    decision = 'INVALID';
    for (const c of checks) if (!c.holds) path.push(`${c.id} failed: ${c.problems.join('; ')}`);
  } else {
    const passes = (id: string): boolean => variants.find((v) => v.id === id)?.passes === true;
    if (passes('v2-3612')) {
      decision = 'v2 with tb-0-3-6-12';
      path.push('rule 1: v2-3612 passes');
    } else if (passes('v2-248')) {
      decision = 'v2 with tb-0-2-4-8';
      path.push('rule 1: v2-3612 fails', 'rule 2: v2-248 passes');
    } else {
      decision = 'v1 fallback (B-01 risk recorded)';
      path.push('rule 1: v2-3612 fails', 'rule 2: v2-248 fails', 'rule 3: v1 fallback (§5.3)');
    }
    if (provisional)
      path.push('provisional (greedy proxy, §5.2): needs a Strategist confirmation before R4');
  }
  return {
    preRegistration: PRE_REGISTRATION.path,
    masterSeed: report.masterSeed,
    botVersion: report.botVersion,
    primary: primaryBot,
    provisional,
    provenance,
    run: {
      engineRulesVersions: [
        ...new Set(report.variants.map((v) => v.rules.engineRulesVersion)),
      ].sort((x, y) => x - y),
      strategistBudget: report.strategistBudget,
      wallTimeSeconds: options.wallTimeSeconds ?? null,
      lexiconVersion: report.variants[0]?.lexiconVersion ?? '',
      profileId: report.variants[0]?.profileId ?? '',
      definitionHash: report.variants[0]?.definitionHash ?? '',
    },
    integrity: checks,
    valid,
    variants,
    pairedDifferences: pairedDifferences(report),
    outcome: { decision, path },
  };
}

function shown(value: number | null, unit: 'bp' | 'tenths'): string {
  if (value === null) return 'n/a';
  return unit === 'bp' ? pct(value) : fixed(value, 1);
}

function passesText(r: Readout, v: VariantReadout): string {
  if (!r.valid) return 'not evaluated (run INVALID)';
  if (v.passes === null) return 'n/a (never gating)';
  return v.passes ? 'yes' : `no (${v.blocking.join(', ')})`;
}

/** Verdict tables and the §5.1 decision path (the digest's core table). */
export function readoutMarkdown(r: Readout): string {
  const lines = [
    `Pre-registration \`${r.preRegistration}\`, master seed \`${r.masterSeed}\`, BOT_VERSION ${String(r.botVersion)}, primary bot \`${r.primary}\`${r.provisional ? ' (provisional, §5.2)' : ''}.`,
    '',
    `engineRulesVersion ${r.run.engineRulesVersions.join(', ')}; Strategist budget ${r.run.strategistBudget === null ? 'n/a' : `${String(r.run.strategistBudget.maxNodes)} / ${String(r.run.strategistBudget.maxCandidates)}`}; lexicon \`${r.run.lexiconVersion}\` (\`${r.run.profileId}\`, \`${r.run.definitionHash}\`); wall time ${r.run.wallTimeSeconds === null ? 'not supplied' : `${String(r.run.wallTimeSeconds)} s`}.`,
    '',
    `**Run ${r.valid ? 'valid' : 'INVALID'}.** Decision: **${r.outcome.decision}**.`,
    '',
    ...r.outcome.path.map((p) => `- ${p}`),
    '',
    '| Integrity | Holds | Problems |',
    '| --- | --- | --- |',
    ...r.integrity.map(
      (c) =>
        `| ${c.id} | ${c.holds ? 'yes' : 'no'} | ${c.problems.length === 0 ? '—' : c.problems.join('; ')} |`,
    ),
    '',
  ];
  for (const v of r.variants) {
    lines.push(
      `### ${v.id} (${v.role}; engineRulesVersion ${String(v.engineRulesVersion)}, candidate \`${v.candidate}\`, ${v.layout}, rulesDigest \`${v.rulesDigest}\`)`,
      '',
      `Passes: ${passesText(r, v)}`,
      '',
      '| ID | Class | Metric | Value | 95 % CI | Rule | Verdict |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    );
    for (const c of v.criteria) {
      const ci =
        c.lo === null || c.hi === null ? '—' : `[${shown(c.lo, c.unit)}, ${shown(c.hi, c.unit)}]`;
      lines.push(
        `| ${c.id} | ${c.class} | ${c.metric} | ${shown(c.value, c.unit)} | ${ci} | ${c.rule} | ${c.verdict} |`,
      );
    }
    lines.push('');
  }
  if (r.pairedDifferences.length > 0) {
    lines.push('| Paired difference (pairing 0) | Metric | a − b |', '| --- | --- | --- |');
    for (const d of r.pairedDifferences) {
      lines.push(
        `| ${d.a} − ${d.b} | ${d.metric} | ${d.unit === 'bp' ? `${fixed(d.diff, 2)} pts` : fixed(d.diff, 1)} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}
