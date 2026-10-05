/**
 * The pre-registered v2 `/balance-check` suite (docs/specs/E-1.6-balance/v2-balance-check.md §2–§4, task V1),
 * encoded once so the run and the readout cannot drift from the file:
 * - variants `v1`, `v2-3612`, `v2-248` (gating or baseline) and the never-gating diagnostics `dx-dw-*`
 *   (DW start + v2 letters and bonuses, primary pairing only, §2);
 * - pairings with FIXED seed indices 0..5 (§3.1): skipping pairing 2 on the Strategist-late path (§5.2) never
 *   shifts the seeds of the others;
 * - master seed `2026100400000e16` and sample sizes 10,000 / 2,000 (§4.1, §4.2).
 *
 * Smaller counts or another seed are allowed for smoke runs (§1.3 exemption), but the readout then marks the run
 * INVALID (I-3), so a smoke result can never be read as balance evidence.
 */
import type { LexiconIndex } from '@codelex/lexicon/index';
import { PERSONALITIES } from '../src/index.js';
import { GREEDY_MATCHED } from './bots.js';
import { RULES_V1, rulesV2, type RulesSelection } from './rules.js';
import type { Pairing, SimBotId, SuiteSpec, Variant } from './simulate.js';

export const PRE_REGISTRATION = Object.freeze({
  path: 'docs/specs/E-1.6-balance/v2-balance-check.md',
  masterSeed: '2026100400000e16',
  mirrorMatches: 10_000,
  pairMatches: 2_000,
  /** §3.1 common settings: `BOT_VERSION` 2. */
  botVersion: 2,
});

export const STRATEGIST = 'strategist';

export type VariantRole = 'baseline' | 'candidate' | 'diagnostic';

export interface BalanceVariant {
  readonly id: string;
  readonly role: VariantRole;
  readonly rules: RulesSelection;
  /** For a diagnostic: the candidate it is the DW-start twin of. */
  readonly twinOf?: string;
}

/** §2, in the pre-registered order. §5.1 applies rule 1 (`v2-3612`) before rule 2 (`v2-248`). */
export const BALANCE_VARIANTS: readonly BalanceVariant[] = Object.freeze([
  { id: 'v1', role: 'baseline', rules: RULES_V1 },
  { id: 'v2-3612', role: 'candidate', rules: rulesV2('tb-0-3-6-12') },
  { id: 'v2-248', role: 'candidate', rules: rulesV2('tb-0-2-4-8') },
  {
    id: 'dx-dw-3612',
    role: 'diagnostic',
    rules: rulesV2('tb-0-3-6-12', 'classic-v1'),
    twinOf: 'v2-3612',
  },
  {
    id: 'dx-dw-248',
    role: 'diagnostic',
    rules: rulesV2('tb-0-2-4-8', 'classic-v1'),
    twinOf: 'v2-248',
  },
]);

/** True iff the bots package ships a `strategist` personality (B4). */
export function strategistAvailable(): boolean {
  return Object.prototype.hasOwnProperty.call(PERSONALITIES, STRATEGIST);
}

/**
 * §3.1 pairings. `primary` is `strategist` (the protocol) or `greedy` (§5.2 Strategist-late path: pairing 0 becomes
 * the full-vocabulary greedy mirror on the same seeds, and pairing 2 is skipped).
 */
export function balancePairings(primary: SimBotId, mirror: number, pair: number): Pairing[] {
  const pairings: Pairing[] = [
    { id: `${primary}-mirror`, index: 0, a: primary, b: primary, matches: mirror },
    { id: 'beginner-mirror', index: 1, a: 'beginner', b: 'beginner', matches: mirror },
  ];
  if (primary === STRATEGIST) {
    pairings.push({
      id: 'strategist-vs-beginner',
      index: 2,
      a: STRATEGIST,
      b: 'beginner',
      matches: pair,
    });
  }
  pairings.push(
    { id: 'beginner-vs-random', index: 3, a: 'beginner', b: 'random-legal', matches: pair },
    {
      id: `${GREEDY_MATCHED}-vs-beginner`,
      index: 4,
      a: GREEDY_MATCHED,
      b: 'beginner',
      matches: pair,
    },
    { id: 'greedy-vs-beginner', index: 5, a: 'greedy', b: 'beginner', matches: pair },
  );
  return pairings;
}

export interface BalanceOptions {
  readonly masterSeed: string;
  readonly primary: SimBotId;
  readonly mirror: number;
  readonly pair: number;
  /** Run the `dx-dw-*` diagnostics (pairing 0 only). */
  readonly diagnostics: boolean;
  /** Restrict to these variant ids (job splitting, §5.3-2); default all. */
  readonly only?: readonly string[];
}

export function balanceSuite(lexicon: LexiconIndex, options: BalanceOptions): SuiteSpec {
  if (options.primary !== STRATEGIST && options.primary !== 'greedy') {
    throw new Error('primary: strategist, or greedy for the §5.2 Strategist-late path');
  }
  if (options.primary === STRATEGIST && !strategistAvailable()) {
    throw new Error('strategist is not available yet (B4): use --primary greedy for the §5.2 path');
  }
  const all = balancePairings(options.primary, options.mirror, options.pair);
  const variants: Variant[] = [];
  for (const v of BALANCE_VARIANTS) {
    if (v.role === 'diagnostic' && !options.diagnostics) continue;
    if (options.only !== undefined && !options.only.includes(v.id)) continue;
    variants.push({
      id: v.id,
      lexicon,
      rules: v.rules,
      pairings: v.role === 'diagnostic' ? all.filter((p) => p.index === 0) : all,
    });
  }
  return { masterSeed: options.masterSeed, variants };
}
