/**
 * Lexicon variants, pairings and options of the B2 simulator CLI (`cli.ts`), kept apart from the entry point so
 * that the smoke test can use them.
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

export interface Options {
  seed: string;
  mirror: number;
  pair: number;
  variants: readonly string[];
  out: string;
  markdown: string;
}

function parseCount(flag: string, value: string): number {
  if (!/^[0-9]{1,6}$/.test(value)) throw new Error(`${flag}: expected a count, got "${value}"`);
  return Number.parseInt(value, 10);
}

export function parseOptions(args: readonly string[]): Options {
  const options: Options = {
    seed: '2026100300000b02',
    mirror: 1_000,
    pair: 500,
    variants: ['with', 'without'],
    out: 'sim-results/b2-report.json',
    markdown: 'sim-results/b2-tables.md',
  };
  // `pnpm simulate -- …` may forward the separator itself.
  const rest = args[0] === '--' ? args.slice(1) : args;
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i] ?? '';
    const value = rest[i + 1];
    if (value === undefined) throw new Error(`${flag}: missing value`);
    switch (flag) {
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
      case '--variants':
        options.variants = value.split(',');
        if (options.variants.some((v) => v !== 'with' && v !== 'without')) {
          throw new Error('--variants: with, without');
        }
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
