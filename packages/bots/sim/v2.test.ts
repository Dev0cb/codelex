/**
 * Sprint 3 B3 (T-2): v1 / draft v2 by flag, the same-vocabulary greedy yardstick (BG-2a), the new metrics (C-10,
 * C-11, bag at end, C-05 CI) and the V1 readout (v2-balance-check §3–§5). Small seeded runs only (§1.3 exemption:
 * ≤ 100 matches per pairing, never evaluated as balance evidence).
 */
import { rulesDigest } from '@codelex/game-engine';
import { describe, expect, it } from 'vitest';
import {
  balancePairings,
  balanceSuite,
  BALANCE_VARIANTS,
  PRE_REGISTRATION,
  strategistAvailable,
} from './balance-check.js';
import { isSimBot, simBot } from './bots.js';
import { readout, readoutMarkdown, type Readout } from './readout.js';
import { toJson, toMarkdown } from './report.js';
import { draftContext, parseRules, RULES_V1, rulesProvenance, rulesV2 } from './rules.js';
import {
  aggregate,
  matchSeed,
  playMatch,
  runSuite,
  type MatchRecord,
  type PairingReport,
  type SuiteReport,
  type VariantReport,
} from './simulate.js';
import { parseOptions, realVariants } from './variants.js';

const SHA = 'a'.repeat(40);
const PROVENANCE = { codeCommit: SHA, lexiconCommit: SHA, preRegistrationBlob: SHA };

describe('rules selection (T-2)', () => {
  it('parses --rules / --candidate / --layout strictly', () => {
    expect(parseRules('v1')).toBe(RULES_V1);
    expect(parseRules('v1', undefined, 'classic-v1')).toBe(RULES_V1);
    expect(parseRules('v2', 'tb-0-3-6-12')).toEqual(rulesV2('tb-0-3-6-12'));
    expect(parseRules('v2', 'tb-0-2-4-8', 'classic-v1')).toEqual({
      engineRulesVersion: 2,
      candidate: 'tb-0-2-4-8',
      layout: 'classic-v1',
      letters: 'letters-v2',
    });
    expect(() => parseRules('v2')).toThrow(/needs --candidate/);
    expect(() => parseRules('v2', 'tb-0-4-8-16')).toThrow(/--candidate/);
    expect(() => parseRules('v2', 'tb-0-2-4-8', 'classic-v9')).toThrow(/--layout/);
    expect(() => parseRules('v1', 'tb-0-2-4-8')).toThrow(/only with --rules v2/);
    expect(() => parseRules('v1', undefined, 'classic-v2')).toThrow(/classic-v1 only/);
    expect(() => parseRules('v3')).toThrow(/v1 or v2/);
  });

  it('opts in only for a draft, always naming the candidate', () => {
    expect(draftContext(RULES_V1)).toBeUndefined();
    expect(draftContext(rulesV2('tb-0-3-6-12'))).toMatchObject({ candidate: 'tb-0-3-6-12' });
    const noCandidate = {
      engineRulesVersion: 2,
      layout: 'classic-v2',
      letters: 'letters-v2',
    } as const;
    expect(draftContext(noCandidate)).not.toHaveProperty('candidate');
  });

  it('records version, candidate, tables, term bonus and rulesDigest (ADR-0014 §D4)', () => {
    expect(rulesProvenance(RULES_V1)).toEqual({
      engineRulesVersion: 1,
      status: 'frozen',
      gameRules: '0.3.1',
      candidate: 'none',
      layout: 'classic-v1',
      letters: 'letters-v1',
      termBonus: [0, 4, 8, 16],
      rulesDigest: rulesDigest(1),
    });
    expect(rulesProvenance(rulesV2('tb-0-3-6-12'))).toMatchObject({
      engineRulesVersion: 2,
      status: 'draft',
      candidate: 'tb-0-3-6-12',
      layout: 'classic-v2',
      letters: 'letters-v2',
      termBonus: [0, 3, 6, 12],
      rulesDigest: rulesDigest(2),
    });
    expect(rulesProvenance(rulesV2('tb-0-2-4-8', 'classic-v1')).termBonus).toEqual([0, 2, 4, 8]);
  });
});

describe('options', () => {
  it('b2 suite: rules flags; balance-check: pre-registered defaults', () => {
    expect(parseOptions([]).rules).toBe(RULES_V1);
    expect(parseOptions(['--rules', 'v2', '--candidate', 'tb-0-2-4-8']).rules).toEqual(
      rulesV2('tb-0-2-4-8'),
    );
    const balance = parseOptions(['--suite', 'balance-check']);
    expect(balance).toMatchObject({
      suite: 'balance-check',
      seed: '2026100400000e16',
      mirror: 10_000,
      pair: 2_000,
      primary: 'strategist',
      diagnostics: true,
      variants: ['v1', 'v2-3612', 'v2-248', 'dx-dw-3612', 'dx-dw-248'],
    });
    expect(
      parseOptions([
        '--suite',
        'balance-check',
        '--primary',
        'greedy',
        '--diagnostics',
        'off',
        '--variants',
        'v1,v2-248',
        '--code-commit',
        SHA,
        '--lexicon-commit',
        SHA,
        '--prereg-blob',
        SHA,
      ]),
    ).toMatchObject({
      primary: 'greedy',
      diagnostics: false,
      variants: ['v1', 'v2-248'],
      codeCommit: SHA,
      lexiconCommit: SHA,
      preRegistrationBlob: SHA,
    });
  });

  it('rejects inconsistent or malformed flags', () => {
    expect(() => parseOptions(['--suite', 'nightly'])).toThrow(/--suite/);
    expect(() => parseOptions(['--suite', 'balance-check', '--rules', 'v2'])).toThrow(
      /fixes the rules/,
    );
    expect(() => parseOptions(['--primary', 'greedy'])).toThrow(/only with --suite balance-check/);
    expect(() => parseOptions(['--suite', 'balance-check', '--primary', 'beginner'])).toThrow(
      /--primary/,
    );
    expect(() => parseOptions(['--suite', 'balance-check', '--diagnostics', 'yes'])).toThrow(
      /on or off/,
    );
    expect(() => parseOptions(['--suite', 'balance-check', '--variants', 'with'])).toThrow(
      /--variants/,
    );
    expect(() => parseOptions(['--code-commit', 'abc'])).toThrow(/40 lowercase hex/);
    expect(() => parseOptions(['--pair', '1', '--pair', '2'])).toThrow(/twice/);
    expect(() => parseOptions(['--rules', 'v2'])).toThrow(/--candidate/);
  });
});

describe('simulator bots', () => {
  it('maps personalities and the BG-2a yardstick; unknown ids throw', () => {
    expect(simBot('beginner')).toEqual({ personality: 'beginner' });
    expect(simBot('greedy-matched')).toMatchObject({
      personality: 'greedy',
      data: { maxDifficultyRank: 1, topWeights: [1] },
    });
    expect(isSimBot('greedy-matched')).toBe(true);
    expect(isSimBot('grandmaster')).toBe(false);
    expect(() => simBot('grandmaster')).toThrow(/unknown simulator bot/);
  });
});

describe('pre-registered suite (§2, §3.1)', () => {
  it('fixes the pairing indices; the §5.2 path skips pairing 2 without shifting seeds', () => {
    const late = balancePairings('greedy', 3, 2);
    expect(late.map((p) => [p.index, p.id, p.matches])).toEqual([
      [0, 'greedy-mirror', 3],
      [1, 'beginner-mirror', 3],
      [3, 'beginner-vs-random', 2],
      [4, 'greedy-matched-vs-beginner', 2],
      [5, 'greedy-vs-beginner', 2],
    ]);
    const full = balancePairings('strategist', 3, 2);
    expect(full.map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(full[2]).toMatchObject({ a: 'strategist', b: 'beginner' });
  });

  it('builds the variants and refuses an unavailable or unknown primary', () => {
    const lexicon = realVariants().with;
    const options = {
      masterSeed: PRE_REGISTRATION.masterSeed,
      primary: 'greedy',
      mirror: 1,
      pair: 1,
    };
    const all = balanceSuite(lexicon, { ...options, diagnostics: true });
    expect(all.variants.map((v) => [v.id, v.pairings.length])).toEqual([
      ['v1', 5],
      ['v2-3612', 5],
      ['v2-248', 5],
      ['dx-dw-3612', 1],
      ['dx-dw-248', 1],
    ]);
    expect(all.variants[3]?.rules).toEqual(rulesV2('tb-0-3-6-12', 'classic-v1'));
    expect(
      balanceSuite(lexicon, { ...options, diagnostics: false }).variants.map((v) => v.id),
    ).toEqual(['v1', 'v2-3612', 'v2-248']);
    expect(
      balanceSuite(lexicon, { ...options, diagnostics: true, only: ['v2-248'] }).variants.map(
        (v) => v.id,
      ),
    ).toEqual(['v2-248']);
    expect(() =>
      balanceSuite(lexicon, { ...options, primary: 'beginner', diagnostics: true }),
    ).toThrow(/primary/);
    if (!strategistAvailable()) {
      expect(() =>
        balanceSuite(lexicon, { ...options, primary: 'strategist', diagnostics: true }),
      ).toThrow(/not available yet/);
    }
  });
});

describe('v1 and draft v2 on the real engine', () => {
  const lexicon = realVariants().with;
  const seed = matchSeed(PRE_REGISTRATION.masterSeed, 0, 0);

  it('plays and replays every variant; bots never fall back after evaluating (I-2)', () => {
    for (const v of BALANCE_VARIANTS) {
      const record = playMatch(lexicon, seed, ['greedy', 'beginner'], 1_000, v.rules);
      expect(record.actions).toBeGreaterThan(10);
      expect(record.tilesPlayed).toBeGreaterThan(0);
      expect(record.termBonus).toBeLessThanOrEqual(record.placeWordPoints);
      const fallbacks = record.turns.filter(
        (t) => t.type !== 'PLACE_WORD' && t.candidatesEvaluated > 0,
      );
      expect(fallbacks).toEqual([]);
    }
  }, 120_000);

  it('the candidate changes scores on the same seed (the host and bots share it)', () => {
    const a = playMatch(lexicon, seed, ['greedy', 'greedy'], 1_000, rulesV2('tb-0-3-6-12'));
    const b = playMatch(lexicon, seed, ['greedy', 'greedy'], 1_000, rulesV2('tb-0-2-4-8'));
    expect(a.finalHash).not.toBe(b.finalHash);
    expect(a.termBonus + b.termBonus).toBeGreaterThan(0);
  }, 120_000);
});

describe('new metrics (C-10, C-11, bag at end)', () => {
  const base: MatchRecord = {
    seed: '0000000000000000',
    seats: ['greedy', 'greedy'],
    firstSeat: 0,
    endReason: 'scoreless_turns',
    scores: [100, 90],
    places: [1, 2],
    actions: 40,
    bagAtEnd: 0,
    rackTilesAtEnd: 4,
    tilesPlayed: 90,
    placeWordPoints: 200,
    termBonus: 50,
    finalHash: '0000000000000000',
    turns: [],
  };
  const pairing = { id: 'greedy-mirror', a: 'greedy', b: 'greedy', matches: 4, index: 0 };

  it('C-10 counts only scoreless-turn endings with bag >= 7', () => {
    const records: MatchRecord[] = [
      { ...base, bagAtEnd: 7, tilesPlayed: 80 },
      { ...base, bagAtEnd: 12, endReason: 'going_out', tilesPlayed: 84 },
      { ...base, bagAtEnd: 3, tilesPlayed: 96 },
      { ...base, bagAtEnd: 0, tilesPlayed: 100 },
    ];
    const r = aggregate(pairing, records);
    expect(r.index).toBe(0);
    expect(r.prematureLock).toMatchObject({ k: 1, n: 4, bp: 2500 });
    expect(r.bagAtEnd).toMatchObject({ empty: 1, oneToSix: 1, sevenPlus: 2 });
    expect(r.tilesPlayed.meanTenths).toBe(900);
    expect(r.termBonusShare.bp).toBe(2500);
    expect(r.matchesWithPass).toBe(0);
  });
});

// --- readout ---

function smokeReport(): SuiteReport {
  const lexicon = realVariants().with;
  const spec = balanceSuite(lexicon, {
    masterSeed: PRE_REGISTRATION.masterSeed,
    primary: 'greedy',
    mirror: 2,
    pair: 2,
    diagnostics: true,
  });
  return runSuite(spec);
}

type Patch = (p: PairingReport) => PairingReport;

/** A report that passes I-3 (seed, counts, BOT_VERSION, commits) with every metric overridable per variant. */
function validFrom(
  report: SuiteReport,
  patches: Readonly<Record<string, Patch>> = {},
): SuiteReport {
  const variants = report.variants.map((v): VariantReport => ({
    ...v,
    pairings: v.pairings.map((p) => {
      const matches = p.index <= 1 ? PRE_REGISTRATION.mirrorMatches : PRE_REGISTRATION.pairMatches;
      const passing: PairingReport = {
        ...p,
        matches,
        replayVerified: matches,
        firstPlayerWin: { k: 5000, n: 10_000, bp: 5000, ci95: { lo: 4902, hi: 5098 } },
        aWin: { k: 1500, n: 2000, bp: 7500, ci95: { lo: 7305, hi: 7685 } },
        termBonusShare: { n: matches, bp: 3000, ci95: { lo: 2900, hi: 3100 } },
        noWordTurnBagNotEmptyBp: 1000,
        prematureLock: { k: 100, n: matches, bp: 100, ci95: { lo: 80, hi: 120 } },
        tilesPlayed: { n: matches, meanTenths: 920, ci95: { lo: 915, hi: 925 } },
        top20TermShareBp: 3000,
        personalities: p.personalities.map((s) => ({
          ...s,
          placeWord: 100,
          placeWordPoints: s.personality === 'beginner' ? 1_300 : 2_000,
          noviceOrIntermediateBp: 9500,
          budgetExhausted: 0,
          fallbacksAfterEvaluation: 0,
        })),
      };
      return (patches[v.id] ?? ((x: PairingReport) => x))(passing);
    }),
  }));
  return { ...report, botVersion: PRE_REGISTRATION.botVersion, variants };
}

function verdict(r: Readout, variant: string, id: string): string | undefined {
  return r.variants.find((v) => v.id === variant)?.criteria.find((c) => c.id === id)?.verdict;
}

describe('V1 readout', () => {
  const smoke = smokeReport();

  it('a smoke run is INVALID (I-3) and yields no decision, but every criterion is computed', () => {
    const r = readout(smoke, 'greedy', {
      codeCommit: '',
      lexiconCommit: '',
      preRegistrationBlob: '',
    });
    expect(r.valid).toBe(false);
    expect(r.outcome.decision).toBe('INVALID');
    const i3 = r.integrity.find((c) => c.id === 'I-3');
    expect(i3?.holds).toBe(false);
    expect(i3?.problems.join('\n')).toMatch(/BOT_VERSION|pre-registered 10000/);
    expect(r.integrity.find((c) => c.id === 'I-1')?.holds).toBe(true);
    expect(r.integrity.find((c) => c.id === 'I-2')?.holds).toBe(true);
    const v2 = r.variants.find((v) => v.id === 'v2-248');
    expect(v2?.criteria.map((c) => c.id)).toEqual([
      'P-1',
      'P-2',
      'P-3',
      'P-4',
      'P-5',
      'P-6',
      'S-1',
      'B-07',
      'BG-1',
      'BG-2a',
      'BG-3',
      'BG-4',
      'BG-5',
    ]);
    expect(verdict(r, 'v2-248', 'B-07')).toBe('NOT-MEASURED');
    const dx = r.variants.find((v) => v.id === 'dx-dw-3612');
    expect(dx?.passes).toBeNull();
    expect(dx?.criteria.map((c) => c.id)).toEqual(['P-1', 'P-2', 'P-3', 'P-4', 'P-5', 'P-6']);
    expect(r.pairedDifferences.length).toBe(5 * 6);
    expect(readoutMarkdown(r)).toContain('Run INVALID');
    expect(JSON.parse(toJson({ readout: r, suite: smoke }))).toHaveProperty('readout.outcome');
    expect(toMarkdown(smoke)).toContain('candidate `tb-0-2-4-8`');
  }, 300_000);

  it('rule 1: both pass → 0/3/6/12; provisional on the greedy path, B-07 excused only there', () => {
    const r = readout(validFrom(smoke), 'greedy', PROVENANCE);
    expect(r.valid).toBe(true);
    expect(r.outcome.decision).toBe('v2 with tb-0-3-6-12');
    expect(r.provisional).toBe(true);
    expect(r.outcome.path.join(' ')).toMatch(/provisional/);
    expect(r.variants.find((v) => v.id === 'v2-248')?.passes).toBe(true);
    expect(verdict(r, 'v2-3612', 'BG-3')).toBe('PASS');
    expect(readoutMarkdown(r)).toContain('Decision: **v2 with tb-0-3-6-12**');
  }, 300_000);

  it('rule 2: v2-3612 fails C-05 on its upper CI → 0/2/4/8', () => {
    const r = readout(
      validFrom(smoke, {
        'v2-3612': (p) =>
          p.index === 0
            ? { ...p, termBonusShare: { n: p.matches, bp: 3450, ci95: { lo: 3360, hi: 3501 } } }
            : p,
      }),
      'greedy',
      PROVENANCE,
    );
    expect(verdict(r, 'v2-3612', 'P-2')).toBe('FAIL');
    expect(r.outcome.decision).toBe('v2 with tb-0-2-4-8');
  }, 300_000);

  it('rule 3: both fail B-01 (one over-corrects) → v1 fallback; thresholds are inclusive', () => {
    const r = readout(
      validFrom(smoke, {
        'v2-3612': (p) =>
          p.index === 0
            ? { ...p, firstPlayerWin: { k: 0, n: 10_000, bp: 4890, ci95: { lo: 4799, hi: 4988 } } }
            : p,
        'v2-248': (p) =>
          p.index === 0
            ? { ...p, firstPlayerWin: { k: 0, n: 10_000, bp: 5110, ci95: { lo: 5012, hi: 5201 } } }
            : p,
        v1: (p) =>
          p.index === 0
            ? { ...p, firstPlayerWin: { k: 0, n: 10_000, bp: 5102, ci95: { lo: 4800, hi: 5200 } } }
            : p,
      }),
      'greedy',
      PROVENANCE,
    );
    expect(verdict(r, 'v2-3612', 'P-1')).toBe('FAIL');
    expect(verdict(r, 'v2-248', 'P-1')).toBe('FAIL');
    expect(verdict(r, 'v1', 'P-1')).toBe('PASS');
    expect(r.outcome.decision).toBe('v1 fallback (B-01 risk recorded)');
  }, 300_000);

  it('L/K excuse only when v1 fails the same criterion; R never excused', () => {
    const lowTiles: Patch = (p) =>
      p.index === 0
        ? { ...p, tilesPlayed: { n: p.matches, meanTenths: 899, ci95: { lo: 890, hi: 905 } } }
        : p;
    const shared = readout(
      validFrom(smoke, { v1: lowTiles, 'v2-3612': lowTiles }),
      'greedy',
      PROVENANCE,
    );
    expect(verdict(shared, 'v2-3612', 'P-5')).toBe('EXCUSED-L');
    expect(verdict(shared, 'v1', 'P-5')).toBe('FAIL');
    expect(shared.outcome.decision).toBe('v2 with tb-0-3-6-12');

    const own = readout(validFrom(smoke, { 'v2-3612': lowTiles }), 'greedy', PROVENANCE);
    expect(verdict(own, 'v2-3612', 'P-5')).toBe('FAIL');
    expect(own.outcome.decision).toBe('v2 with tb-0-2-4-8');

    const weakBot: Patch = (p) =>
      p.index === 3 ? { ...p, aWin: { k: 0, n: 2000, bp: 7999, ci95: { lo: 7800, hi: 8170 } } } : p;
    const k = readout(validFrom(smoke, { v1: weakBot, 'v2-248': weakBot }), 'greedy', PROVENANCE);
    expect(verdict(k, 'v2-248', 'BG-1')).toBe('EXCUSED-K');

    const seat: Patch = (p) =>
      p.index === 1
        ? { ...p, firstPlayerWin: { k: 0, n: 10_000, bp: 5300, ci95: { lo: 5201, hi: 5398 } } }
        : p;
    const r = readout(validFrom(smoke, { v1: seat, 'v2-3612': seat }), 'greedy', PROVENANCE);
    expect(verdict(r, 'v2-3612', 'S-1')).toBe('FAIL');
    expect(r.outcome.decision).toBe('v2 with tb-0-2-4-8');
  }, 300_000);

  it('I-1 / I-2 failures and a non-pre-registered seed invalidate the run', () => {
    const broken = validFrom(smoke, {
      v1: (p) =>
        p.index === 3
          ? {
              ...p,
              replayVerified: p.matches - 1,
              personalities: p.personalities.map((s) => ({ ...s, fallbacksAfterEvaluation: 1 })),
            }
          : p,
    });
    const r = readout(broken, 'greedy', PROVENANCE);
    expect(r.integrity.map((c) => c.holds)).toEqual([false, false, true]);
    expect(r.outcome.decision).toBe('INVALID');
    const seed = readout(
      { ...validFrom(smoke), masterSeed: '0123456789abcdef' },
      'greedy',
      PROVENANCE,
    );
    expect(seed.integrity.find((c) => c.id === 'I-3')?.problems.join()).toMatch(/master seed/);
    const strategistRun = readout(validFrom(smoke), 'strategist', PROVENANCE);
    expect(strategistRun.integrity.find((c) => c.id === 'I-3')?.problems.join()).toMatch(
      /pairing 2 missing/,
    );
    expect(verdict(strategistRun, 'v2-3612', 'B-07')).toBe('NOT-MEASURED');
    expect(strategistRun.variants.find((v) => v.id === 'v2-3612')?.blocking).toContain('B-07');
  }, 300_000);
});
