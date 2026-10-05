/**
 * Sprint 3 B3 (T-2): v1 / draft v2 by flag, the same-vocabulary greedy yardstick (BG-2a), the new metrics (C-10,
 * C-11, bag at end, C-05 CI) and the V1 readout (v2-balance-check §3–§5). Small seeded runs only (§1.3 exemption:
 * ≤ 100 matches per pairing, never evaluated as balance evidence).
 */
import { rulesDigest } from '@codelex/game-engine';
import { describe, expect, it } from 'vitest';
import {
  PROVENANCE,
  smokeReport,
  validFrom,
  verdict,
  type Patch,
} from '../test/support/sim-reports.js';
import {
  assertV2Exemption,
  balancePairings,
  balanceSuite,
  BALANCE_VARIANTS,
  PRE_REGISTRATION,
  SMOKE_MAX_MATCHES,
  strategistAvailable,
} from './balance-check.js';
import { isSimBot, simBot } from './bots.js';
import { readout, readoutMarkdown } from './readout.js';
import { toJson, toMarkdown } from './report.js';
import { draftContext, parseRules, RULES_V1, rulesProvenance, rulesV2 } from './rules.js';
import {
  aggregate,
  tilesInTable,
  matchSeed,
  playMatch,
  runSuite,
  type MatchRecord,
  type SuiteReport,
} from './simulate.js';
import { meanCiTenths } from './stats.js';
import { parseOptions, realVariants } from './variants.js';

const SHA = 'a'.repeat(40);

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
        '--lexicon-version',
        'lex-3',
        '--definition-hash',
        '0123456789abcdef',
      ]),
    ).toMatchObject({
      expected: { lexiconVersion: 'lex-3', definitionHash: '0123456789abcdef' },
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
    expect(() => parseOptions(['--definition-hash', '0123456789abcdef'])).toThrow(
      /only with --suite/,
    );
    expect(() => parseOptions(['--suite', 'balance-check', '--definition-hash', 'XYZ'])).toThrow(
      /16 lowercase hex/,
    );
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

  it('plays and replays every variant; no engine refusal and no fallback after evaluating (I-2)', () => {
    for (const v of BALANCE_VARIANTS) {
      const record = playMatch(lexicon, seed, ['greedy', 'beginner'], 1_000, v.rules);
      expect(record.actions).toBeGreaterThan(10);
      expect(record.tilesPlayed).toBeGreaterThan(0);
      expect(record.termBonus).toBeLessThanOrEqual(record.placeWordPoints);
      const fallbacks = record.turns.filter(
        (t) => t.type !== 'PLACE_WORD' && t.candidatesEvaluated > 0,
      );
      expect(fallbacks).toEqual([]);
      expect(record.turns.reduce((n, t) => n + t.candidatesRefused, 0)).toBe(0);
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
    const r = aggregate(pairing, records, 0, 100);
    expect(r.index).toBe(0);
    expect(r.prematureLock).toMatchObject({ k: 1, n: 4, bp: 2500 });
    expect(r.bagAtEnd).toMatchObject({ empty: 1, oneToSix: 1, sevenPlus: 2 });
    expect(r.tilesPlayed.meanTenths).toBe(900);
    expect(r.termBonusShare.bp).toBe(2500);
    expect(r.matchesWithPass).toBe(0);
  });
});

describe('review items 3, 4, 7, 8', () => {
  const lexicon = realVariants().with;
  const balanced = (
    mirror: number,
    pair: number,
    masterSeed: string = PRE_REGISTRATION.masterSeed,
  ) => balanceSuite(lexicon, { masterSeed, primary: 'greedy', mirror, pair, diagnostics: true });

  it('item 3: §1.3 exemption is enforced; v2 outside the registered suite is capped at 100 per pairing', () => {
    expect(SMOKE_MAX_MATCHES).toBe(100);
    const v2 = (matches: number) => ({
      masterSeed: PRE_REGISTRATION.masterSeed,
      variants: [
        {
          id: 'v2',
          lexicon,
          rules: rulesV2('tb-0-2-4-8'),
          pairings: [{ id: 'm', a: 'beginner', b: 'beginner', matches }],
        },
      ],
    });
    expect(() => {
      assertV2Exemption(v2(100));
    }).not.toThrow();
    expect(() => {
      assertV2Exemption(v2(101));
    }).toThrow(/§1\.3 exemption.*101 matches/);
    expect(() => runSuite(v2(101))).toThrow(/§1\.3 exemption/);
    // v1 is not a v2 run: no cap.
    const v1Big = v2(5_000);
    expect(() => {
      assertV2Exemption({
        ...v1Big,
        variants: v1Big.variants.map((v) => ({ ...v, id: 'v1', rules: RULES_V1 })),
      });
    }).not.toThrow();
    // The registered suite (seed, counts, variants) is the only uncapped v2 run.
    expect(() => {
      assertV2Exemption(balanced(10_000, 2_000));
    }).not.toThrow();
    expect(() => {
      assertV2Exemption(balanced(10_000, 1_999));
    }).toThrow(/§1\.3 exemption/);
    expect(() => {
      assertV2Exemption(balanced(10_000, 2_000, '0123456789abcdef'));
    }).toThrow(/§1\.3 exemption/);
    expect(() => {
      assertV2Exemption(balanced(100, 100, '0123456789abcdef'));
    }).not.toThrow();
  });

  it('item 4: the suite report carries engineRulesVersions and the Strategist budget', () => {
    const report = smokeReport();
    expect(report.engineRulesVersions).toEqual([1, 2]);
    // B4 (BOT_VERSION 2) ships Strategist with the provisional 70,000 / 500 budget (bots-api §5.5).
    expect(strategistAvailable()).toBe(true);
    expect(report.strategistBudget).toEqual({ maxNodes: 70_000, maxCandidates: 500 });
  }, 300_000);

  it('item 7: an unknown candidate throws instead of falling back to the default rules', () => {
    const bogus = { ...rulesV2('tb-0-2-4-8'), candidate: 'tb-0-4-8-16' } as unknown as Parameters<
      typeof rulesProvenance
    >[0];
    expect(() => rulesProvenance(bogus)).toThrow(/unknown candidate tb-0-4-8-16/);
    expect(() => rulesProvenance({ ...RULES_V1, candidate: 'tb-0-2-4-8' })).toThrow(
      /frozen version has no candidates/,
    );
  });

  it('item 8: the C-11 CI ceiling is the letter table tile count, not a constant', () => {
    expect(meanCiTenths([95], 104).ci95).toEqual({ lo: 0, hi: 1040 });
    const one: MatchRecord = {
      seed: '0000000000000000',
      seats: ['greedy', 'greedy'],
      firstSeat: 0,
      endReason: 'going_out',
      scores: [1, 0],
      places: [1, 2],
      actions: 1,
      bagAtEnd: 0,
      rackTilesAtEnd: 0,
      tilesPlayed: 99,
      placeWordPoints: 1,
      termBonus: 0,
      finalHash: '0000000000000000',
      turns: [],
    };
    const r = aggregate({ id: 'x', a: 'greedy', b: 'greedy', matches: 1 }, [one], 0, 100);
    expect(r.tilesPlayed.ci95.hi).toBe(1000);
    expect(tilesInTable('letters-v1')).toBe(100);
    expect(tilesInTable('letters-v2')).toBe(100);
  });
});

// --- readout ---

describe('V1 readout', () => {
  const smoke = smokeReport();

  it('a smoke run is INVALID (I-3), yields no decision and no per-variant pass, but computes every criterion', () => {
    const r = readout(smoke, 'greedy', {
      codeCommit: '',
      lexiconCommit: '',
      preRegistrationBlob: '',
    });
    expect(r.valid).toBe(false);
    expect(r.outcome.decision).toBe('INVALID');
    const i3 = r.integrity.find((c) => c.id === 'I-3');
    expect(i3?.holds).toBe(false);
    expect(i3?.problems.join('\n')).toMatch(/pre-registered 10000/);
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
    // Item 9: no per-variant pass/fail on an INVALID run.
    for (const v of r.variants) expect(v.passes).toBeNull();
    const dx = r.variants.find((v) => v.id === 'dx-dw-3612');
    expect(dx?.criteria.map((c) => c.id)).toEqual(['P-1', 'P-2', 'P-3', 'P-4', 'P-5', 'P-6']);
    expect(r.pairedDifferences.length).toBe(5 * 6);
    const md = readoutMarkdown(r);
    expect(md).toContain('Run INVALID');
    expect(md).toContain('Passes: not evaluated (run INVALID)');
    expect(md).not.toMatch(/Passes: (yes|no \(|n\/a)/);
    expect(JSON.parse(toJson({ readout: r, suite: smoke }))).toHaveProperty('readout.outcome');
    expect(toMarkdown(smoke)).toContain('candidate `tb-0-2-4-8`');
  }, 300_000);

  it('records the §6 run-level fields', () => {
    const r = readout(validFrom(smoke), 'greedy', PROVENANCE, { wallTimeSeconds: 2_700 });
    expect(r.run).toEqual({
      engineRulesVersions: [1, 2],
      strategistBudget: { maxNodes: 70_000, maxCandidates: 500 },
      wallTimeSeconds: 2_700,
      lexiconVersion: smoke.variants[0]?.lexiconVersion,
      profileId: 'global-ranked',
      definitionHash: smoke.variants[0]?.definitionHash,
    });
    expect(readout(validFrom(smoke), 'greedy', PROVENANCE).run.wallTimeSeconds).toBeNull();
  }, 300_000);

  it('rule 1: both pass → 0/3/6/12; provisional on the greedy path, B-07 excused only there', () => {
    const r = readout(validFrom(smoke), 'greedy', PROVENANCE);
    expect(r.valid).toBe(true);
    expect(r.outcome.decision).toBe('v2 with tb-0-3-6-12');
    expect(r.provisional).toBe(true);
    expect(r.outcome.path.join(' ')).toMatch(/provisional \(greedy proxy/);
    expect(r.variants.find((v) => v.id === 'v2-248')?.passes).toBe(true);
    expect(verdict(r, 'v2-3612', 'BG-3')).toBe('PASS');
    expect(readoutMarkdown(r)).toContain('Decision: **v2 with tb-0-3-6-12**');
  }, 300_000);

  it('§5.2 clarification (2026-10-05): the greedy path accepts BOT_VERSION 1 or 2; Strategist needs 2', () => {
    const v1Bots = { ...validFrom(smoke), botVersion: 1 };
    const greedy = readout(v1Bots, 'greedy', PROVENANCE);
    expect(greedy.valid).toBe(true);
    expect(greedy.botVersion).toBe(1);
    expect(greedy.outcome.path.join(' ')).toMatch(/provisional/);
    expect(readout({ ...v1Bots, botVersion: 3 }, 'greedy', PROVENANCE).valid).toBe(false);
    const strategist = readout(v1Bots, 'strategist', PROVENANCE);
    expect(strategist.integrity.find((c) => c.id === 'I-3')?.problems.join()).toMatch(
      /BOT_VERSION 1, pre-registered 2/,
    );
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

  it('§3.3: a criterion v1 did not measure counts as a v1 FAIL, so the candidate L/K FAIL is excused', () => {
    const r = readout(
      validFrom(smoke, {
        v1: (p) =>
          p.index === 4 ? { ...p, aWin: { k: 0, n: 0, bp: 0, ci95: { lo: 0, hi: 10_000 } } } : p,
        'v2-3612': (p) =>
          p.index === 4
            ? { ...p, aWin: { k: 0, n: 2000, bp: 9000, ci95: { lo: 8860, hi: 9120 } } }
            : p,
      }),
      'greedy',
      PROVENANCE,
    );
    expect(verdict(r, 'v1', 'BG-2a')).toBe('NOT-MEASURED');
    expect(r.variants.find((v) => v.id === 'v1')?.blocking).toContain('BG-2a');
    expect(verdict(r, 'v2-3612', 'BG-2a')).toBe('EXCUSED-K');
    expect(r.outcome.decision).toBe('v2 with tb-0-3-6-12');
  }, 300_000);

  it('I-1 / I-2 failures and a non-pre-registered seed invalidate the run', () => {
    const broken = validFrom(smoke, {
      v1: (p) =>
        p.index === 3
          ? {
              ...p,
              replayVerified: p.matches - 1,
              personalities: p.personalities.map((s) => ({ ...s, candidatesRefused: 1 })),
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

  it('I-2 counts engine refusals for every bot, voluntary exchanges excluded (Strategist included)', () => {
    const exchanges: Patch = (p) =>
      p.index === 0
        ? {
            ...p,
            personalities: p.personalities.map((s) => ({
              ...s,
              personality: 'strategist',
              fallbacksAfterEvaluation: 40,
            })),
          }
        : p;
    expect(
      readout(validFrom(smoke, { v1: exchanges }), 'greedy', PROVENANCE).integrity[1]?.holds,
    ).toBe(true);
    const refused: Patch = (p) =>
      p.index === 0
        ? {
            ...p,
            personalities: p.personalities.map((s) => ({
              ...s,
              personality: 'strategist',
              candidatesRefused: 1,
            })),
          }
        : p;
    const r = readout(validFrom(smoke, { v1: refused }), 'greedy', PROVENANCE);
    expect(r.integrity[1]).toMatchObject({ id: 'I-2', holds: false });
    expect(r.integrity[1]?.problems.join()).toMatch(/strategist: 1 engine refusal/);
  }, 300_000);

  it('I-3 checks the lexicon pin (§4.3): one lexicon for all variants, global-ranked, expected values', () => {
    const report = validFrom(smoke);
    const version = report.variants[0]?.lexiconVersion ?? '';
    const hash = report.variants[0]?.definitionHash ?? '';
    const ok = readout(report, 'greedy', PROVENANCE, {
      expected: { lexiconVersion: version, definitionHash: hash },
    });
    expect(ok.valid).toBe(true);
    const wrong = readout(report, 'greedy', PROVENANCE, {
      expected: { lexiconVersion: 'lex-0.0.0', definitionHash: '0000000000000000' },
    });
    expect(wrong.integrity[2]?.problems.join('\n')).toMatch(
      /lexiconVersion .* expected lex-0\.0\.0/,
    );
    expect(wrong.integrity[2]?.problems.join('\n')).toMatch(/definitionHash .* expected 0{16}/);
    const mixed: SuiteReport = {
      ...report,
      variants: report.variants.map((v, i) =>
        i === 1 ? { ...v, definitionHash: 'ffffffffffffffff', profileId: 'season-x' } : v,
      ),
    };
    const m = readout(mixed, 'greedy', PROVENANCE).integrity[2]?.problems.join('\n') ?? '';
    expect(m).toMatch(/profile season-x, pre-registered global-ranked/);
    expect(m).toMatch(/lexicon differs between variants/);
  }, 300_000);
});
