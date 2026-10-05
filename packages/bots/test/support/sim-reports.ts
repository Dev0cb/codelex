/**
 * Readout fixtures (sprint 3 B3): one small real balance-check run (§1.3 exemption: 2 matches per pairing), and a
 * patcher that makes it look like a valid pre-registered run (seed, counts, BOT_VERSION, commits) with every
 * metric overridable per variant. Used by `sim/v2.test.ts` and `sim/merge.test.ts`.
 */
import { balanceSuite, PRE_REGISTRATION } from '../../sim/balance-check.js';
import type { Readout, RunProvenance } from '../../sim/readout.js';
import {
  runSuite,
  type PairingReport,
  type SuiteReport,
  type VariantReport,
} from '../../sim/simulate.js';
import { realVariants } from '../../sim/variants.js';

export const SHA = 'a'.repeat(40);
export const PROVENANCE: RunProvenance = {
  codeCommit: SHA,
  lexiconCommit: SHA,
  preRegistrationBlob: SHA,
};

let cached: SuiteReport | undefined;

/** The real suite on the §5.2 path, 2 matches per pairing, all five variants (computed once per file). */
export function smokeReport(): SuiteReport {
  if (cached !== undefined) return cached;
  const spec = balanceSuite(realVariants().with, {
    masterSeed: PRE_REGISTRATION.masterSeed,
    primary: 'greedy',
    mirror: 2,
    pair: 2,
    diagnostics: true,
  });
  cached = runSuite(spec);
  return cached;
}

export type Patch = (p: PairingReport) => PairingReport;

/** A report that passes I-3 (seed, counts, BOT_VERSION 2, commits) with every metric passing unless patched. */
export function validFrom(
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
          candidatesRefused: 0,
        })),
      };
      return (patches[v.id] ?? ((x: PairingReport) => x))(passing);
    }),
  }));
  return { ...report, botVersion: PRE_REGISTRATION.botVersion, variants };
}

export function verdict(r: Readout, variant: string, id: string): string | undefined {
  return r.variants.find((v) => v.id === variant)?.criteria.find((c) => c.id === id)?.verdict;
}
