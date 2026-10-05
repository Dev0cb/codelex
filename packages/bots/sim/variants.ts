/**
 * Lexicon variants, pairings and options of the simulator CLI (`cli.ts`), kept apart from the entry point so
 * that the smoke test can use them. Two suites: the B2 grid under one rules selection (`--rules v1`, or
 * `--rules v2 --candidate tb-0-2-4-8|tb-0-3-6-12 [--layout classic-v1]`), and the pre-registered V1 balance
 * check (`--suite balance-check`, `balance-check.ts`).
 */
import {
  GLOBAL_PROFILE,
  lexiconContentDocument,
  profileDefinitionHash,
} from '@codelex/lexicon/canonical';
import {
  buildLexiconIndex,
  decodeLexiconIndex,
  type LexiconIndex,
  type LexiconVersion,
  type ReferenceTermInput,
} from '@codelex/lexicon/index';
import { loadLexicon } from '@codelex/lexicon/validate';
import { BALANCE_VARIANTS, PRE_REGISTRATION, STRATEGIST } from './balance-check.js';
import { parseRules, RULES_V1, type RulesSelection } from './rules.js';
import type { Pairing } from './simulate.js';

/**
 * Simulation-only profile (E-1.7 D-14, AC-20): every term, no inflection. The lexicon tooling has no
 * `inflections: none` profile option yet (owner lexicon-engineer); this definition only names the variant and
 * gives it its own definitionHash, so it can never be confused with `global-ranked`.
 */
export const NO_INFLECTIONS_PROFILE = Object.freeze({
  id: 'global-no-inflections',
  kind: 'global',
  include: Object.freeze({ all: true }),
  inflections: 'none',
});

export type SuiteId = 'b2' | 'balance-check';

export interface Options {
  /** `b2` (default): the B2 grid under one rules selection. `balance-check`: the pre-registered V1 suite. */
  suite: SuiteId;
  seed: string;
  mirror: number;
  pair: number;
  /** b2: `with`, `without`. balance-check: variant ids of §2 to run (job splitting, §5.3-2); default all. */
  variants: readonly string[];
  out: string;
  markdown: string;
  /** b2 suite only (`--rules`, `--candidate`, `--layout`); balance-check fixes the rules per variant (§2). */
  rules: RulesSelection;
  /** balance-check: pairing-0 bot, `strategist` or `greedy` (§5.2 Strategist-late path). */
  primary: string;
  /** balance-check: run the `dx-dw-*` diagnostics (`--diagnostics on|off`, default on). */
  diagnostics: boolean;
  /** Workflow inputs recorded in the results JSON (§6); required for a valid run (I-3). */
  codeCommit: string;
  lexiconCommit: string;
  preRegistrationBlob: string;
}

function parseCount(flag: string, value: string): number {
  if (!/^[0-9]{1,6}$/.test(value)) throw new Error(`${flag}: expected a count, got "${value}"`);
  return Number.parseInt(value, 10);
}

function parseSha(flag: string, value: string): string {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error(`${flag}: 40 lowercase hex chars`);
  return value;
}

const B2_VARIANTS = ['with', 'without'];

export function parseOptions(args: readonly string[]): Options {
  const given = new Map<string, string>();
  // `pnpm simulate -- …` may forward the separator itself.
  const rest = args[0] === '--' ? args.slice(1) : args;
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i] ?? '';
    const value = rest[i + 1];
    if (value === undefined) throw new Error(`${flag}: missing value`);
    if (given.has(flag)) throw new Error(`${flag}: given twice`);
    given.set(flag, value);
  }
  const suiteFlag = given.get('--suite') ?? 'b2';
  if (suiteFlag !== 'b2' && suiteFlag !== 'balance-check')
    throw new Error('--suite: b2 or balance-check');
  const suite: SuiteId = suiteFlag;
  const balance = suite === 'balance-check';
  const options: Options = {
    suite,
    seed: balance ? PRE_REGISTRATION.masterSeed : '2026100300000b02',
    mirror: balance ? PRE_REGISTRATION.mirrorMatches : 1_000,
    pair: balance ? PRE_REGISTRATION.pairMatches : 500,
    variants: balance ? BALANCE_VARIANTS.map((v) => v.id) : B2_VARIANTS,
    out: balance ? 'sim-results/balance-check-results.json' : 'sim-results/b2-report.json',
    markdown: balance ? 'sim-results/balance-check-readout.md' : 'sim-results/b2-tables.md',
    rules: RULES_V1,
    primary: STRATEGIST,
    diagnostics: true,
    codeCommit: '',
    lexiconCommit: '',
    preRegistrationBlob: '',
  };
  const rulesFlags = ['--rules', '--candidate', '--layout'].filter((f) => given.has(f));
  const balanceFlags = ['--primary', '--diagnostics'].filter((f) => given.has(f));
  if (balance && rulesFlags.length > 0) {
    throw new Error(
      `${rulesFlags.join(', ')}: the balance-check suite fixes the rules per variant (§2)`,
    );
  }
  if (!balance && balanceFlags.length > 0) {
    throw new Error(`${balanceFlags.join(', ')}: only with --suite balance-check`);
  }
  if (!balance) {
    options.rules = parseRules(
      given.get('--rules') ?? 'v1',
      given.get('--candidate'),
      given.get('--layout'),
    );
  }
  for (const [flag, value] of given) {
    switch (flag) {
      case '--suite':
      case '--rules':
      case '--candidate':
      case '--layout':
        break;
      case '--seed':
        if (!/^[0-9a-f]{16}$/.test(value)) throw new Error('--seed: 16 lowercase hex chars');
        options.seed = value;
        break;
      case '--mirror':
        options.mirror = parseCount(flag, value);
        break;
      case '--pair':
        options.pair = parseCount(flag, value);
        break;
      case '--variants': {
        const list = value.split(',');
        const allowed = balance ? BALANCE_VARIANTS.map((v) => v.id) : B2_VARIANTS;
        if (list.some((v) => !allowed.includes(v))) {
          throw new Error(`--variants: ${allowed.join(', ')}`);
        }
        options.variants = list;
        break;
      }
      case '--primary':
        if (value !== STRATEGIST && value !== 'greedy') {
          throw new Error('--primary: strategist, or greedy (§5.2 Strategist-late path)');
        }
        options.primary = value;
        break;
      case '--diagnostics':
        if (value !== 'on' && value !== 'off') throw new Error('--diagnostics: on or off');
        options.diagnostics = value === 'on';
        break;
      case '--code-commit':
        options.codeCommit = parseSha(flag, value);
        break;
      case '--lexicon-commit':
        options.lexiconCommit = parseSha(flag, value);
        break;
      case '--prereg-blob':
        options.preRegistrationBlob = parseSha(flag, value);
        break;
      case '--out':
        options.out = value;
        break;
      case '--markdown':
        options.markdown = value;
        break;
      default:
        throw new Error(`unknown option ${flag}`);
    }
  }
  return options;
}

function decoded(
  version: string,
  profile: { readonly id: string; readonly kind: 'global'; readonly definitionHash: string },
  terms: readonly ReferenceTermInput[],
  blocklist: readonly string[],
): LexiconIndex {
  const built = buildLexiconIndex(
    { version, profile, document: { terms }, blocklist },
    { formatVersion: 1, gaddag: true },
  );
  if (!built.ok) throw new Error(`buildLexiconIndex: ${built.error.code} ${built.error.message}`);
  const index = decodeLexiconIndex(built.value, {
    version: version as LexiconVersion,
    profileId: profile.id,
  });
  if (!index.ok) throw new Error(`decodeLexiconIndex: ${index.error.code}`);
  return index.value;
}

/** The real `global-ranked` index and its no-inflection variant (same lexiconVersion, own profile). */
export function realVariants(): { readonly with: LexiconIndex; readonly without: LexiconIndex } {
  const lex = loadLexicon();
  const terms = lexiconContentDocument(lex).terms;
  const blocklist = [...lex.blocklist];
  return {
    with: decoded(
      lex.version,
      {
        id: GLOBAL_PROFILE.id,
        kind: 'global',
        definitionHash: profileDefinitionHash(GLOBAL_PROFILE),
      },
      terms,
      blocklist,
    ),
    without: decoded(
      lex.version,
      {
        id: NO_INFLECTIONS_PROFILE.id,
        kind: 'global',
        definitionHash: profileDefinitionHash(NO_INFLECTIONS_PROFILE),
      },
      terms.map((t) => ({ ...t, inflections: [] })),
      blocklist,
    ),
  };
}

export function pairingsFor(options: Options): { with: Pairing[]; without: Pairing[] } {
  const mirror: Pairing = {
    id: 'beginner-mirror',
    a: 'beginner',
    b: 'beginner',
    matches: options.mirror,
  };
  return {
    with: [
      mirror,
      { id: 'beginner-vs-random', a: 'beginner', b: 'random-legal', matches: options.pair },
      { id: 'greedy-vs-beginner', a: 'greedy', b: 'beginner', matches: options.pair },
    ],
    // Pairing index 0 in both variants ⇒ the same match seeds (paired comparison, AC-20).
    without: [mirror],
  };
}
