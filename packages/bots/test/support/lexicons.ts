/**
 * Lexicon fixtures for the bots' tests: the real lexicon data (as `pnpm lexicon:validate` sees it), a tiny
 * hand-written lexicon, and seeded synthetic lexicons of a given size (2,000 and 50,000 forms for Q-A2).
 *
 * Automata come from the index itself (L5): the reference index (`createReferenceIndex`, unminimised tries built
 * on first access) by default, or the shipped `.clxi` decoder (`buildLexiconIndex` + `decodeLexiconIndex`, minimal
 * automata) with `clxi`. `gaddag: false` gives an index without a GADDAG (the DAWG fallback path, BOT-8).
 */
import { getLetterTable } from '@codelex/game-engine';
import { createRng } from '@codelex/game-engine/rng';
import {
  GLOBAL_PROFILE,
  lexiconContentDocument,
  profileDefinitionHash,
} from '@codelex/lexicon/canonical';
import {
  buildLexiconIndex,
  createReferenceIndex,
  decodeLexiconIndex,
  type DefinitionHash,
  type Difficulty,
  type LexiconIndex,
  type LexiconProfileRef,
  type LexiconVersion,
  type ReferenceTermInput,
} from '@codelex/lexicon/index';
import { loadLexicon } from '@codelex/lexicon/validate';

export const TEST_PROFILE = {
  id: 'global-ranked',
  kind: 'global',
  definitionHash: 'fedcba9876543210' as DefinitionHash,
} as const;

export interface FixtureOptions {
  /** Expose a GADDAG (default true); false = DAWG fallback path. */
  readonly gaddag?: boolean;
  /** Decode a built `.clxi` artefact (minimal automata) instead of the reference index (default false). */
  readonly clxi?: boolean;
}

/** An index over `terms`, from the reference implementation or a built and decoded `.clxi` artefact. */
export function indexOf(
  version: string,
  profile: LexiconProfileRef,
  terms: readonly ReferenceTermInput[],
  options: FixtureOptions = {},
  blocklist: readonly string[] = [],
): LexiconIndex {
  const gaddag = options.gaddag ?? true;
  if (options.clxi !== true) {
    return createReferenceIndex({
      version: version as LexiconVersion,
      profile,
      document: { terms },
      gaddag,
    });
  }
  const built = buildLexiconIndex(
    { version, profile, document: { terms }, blocklist },
    { formatVersion: 1, gaddag },
  );
  if (!built.ok) throw new Error(`buildLexiconIndex: ${built.error.code} ${built.error.message}`);
  const decoded = decodeLexiconIndex(built.value, {
    version: version as LexiconVersion,
    profileId: profile.id,
  });
  if (!decoded.ok) throw new Error(`decodeLexiconIndex: ${decoded.error.code}`);
  return decoded.value;
}

const realCache = new Map<string, LexiconIndex>();

/** The real lexicon (`packages/lexicon/data`, `global-ranked`), with its own GADDAG unless `gaddag` is false. */
export function realIndex(options: FixtureOptions = {}): LexiconIndex {
  const key = `${String(options.gaddag ?? true)}:${String(options.clxi ?? false)}`;
  let index = realCache.get(key);
  if (index === undefined) {
    const lex = loadLexicon();
    index = indexOf(
      lex.version,
      {
        id: GLOBAL_PROFILE.id,
        kind: GLOBAL_PROFILE.kind,
        definitionHash: profileDefinitionHash(GLOBAL_PROFILE) as DefinitionHash,
      },
      lexiconContentDocument(lex).terms,
      options,
      [...lex.blocklist],
    );
    realCache.set(key, index);
  }
  return index;
}

/** The real lexicon without a GADDAG (an artefact built without the section, BOT-8 DAWG fallback). */
export function realIndexWithoutGaddag(): LexiconIndex {
  return realIndex({ gaddag: false });
}

export function term(
  form: string,
  difficulty: Difficulty = 'novice',
  inflections: readonly string[] = [],
): ReferenceTermInput {
  return {
    id: form.toLowerCase(),
    playable: true,
    form,
    difficulty,
    categories: ['networking'],
    inflections: inflections.map((f) => ({ form: f, kind: 'plural' })),
    relations: [],
    gameValue: 1,
    knowledgeXp: 1,
  };
}

/** A lexicon of the given terms (reference index; GADDAG unless `gaddag` is false). */
export function lexiconOf(
  terms: readonly ReferenceTermInput[],
  version = '0123456789abcdef',
  gaddag = true,
): LexiconIndex {
  return indexOf(version, TEST_PROFILE, terms, { gaddag });
}

/** Tiny lexicon for completeness checks and crafted positions. */
export const TINY_TERMS: readonly ReferenceTermInput[] = [
  term('AI'),
  term('AD'),
  term('IP', 'novice'),
  term('IT'),
  term('ID'),
  term('OS'),
  term('TO'),
  term('AT'),
  term('ON'),
  term('NO'),
  term('API', 'novice'),
  term('APT', 'intermediate'),
  term('DNS', 'intermediate'),
  term('POD', 'advanced', ['PODS']),
  term('TCP', 'intermediate'),
  term('GIT', 'novice'),
  term('NODE', 'novice', ['NODES']),
  term('CODE', 'novice'),
  term('DATA', 'novice'),
  term('TOKEN', 'advanced', ['TOKENS']),
  term('STATION', 'expert'),
  term('NOTES', 'expert'),
];

export function tinyIndex(gaddag = true): LexiconIndex {
  return lexiconOf(TINY_TERMS, '0123456789abcdef', gaddag);
}

const LENGTH_WEIGHTS: readonly (readonly [number, number])[] = [
  [2, 4],
  [3, 14],
  [4, 18],
  [5, 18],
  [6, 15],
  [7, 12],
  [8, 9],
  [9, 5],
  [10, 3],
  [11, 1],
  [12, 1],
];

function weightedPick(weights: readonly number[], draw: number): number {
  let acc = 0;
  for (let i = 0; i < weights.length; i += 1) {
    acc += weights[i] ?? 0;
    if (draw < acc) return i;
  }
  return weights.length - 1;
}

/**
 * Seeded synthetic lexicon of `size` distinct forms: lengths 2–12 (mode 4–5), letters drawn with the
 * `letters-v1` tile frequencies, difficulties uniform. Denser in short forms than real tech vocabulary, so it is
 * a pessimistic fixture for node counts.
 */
export function syntheticIndex(
  size: number,
  seedWord = 1,
  options: FixtureOptions = {},
): LexiconIndex {
  const rng = createRng([seedWord >>> 0 || 1, size >>> 0, 0x9e3779b9, 0x7f4a7c15]);
  const letterWeights = getLetterTable('letters-v1').counts;
  const letterTotal = letterWeights.reduce((a, b) => a + b, 0);
  const lengthTotal = LENGTH_WEIGHTS.reduce((a, [, w]) => a + w, 0);
  const difficulties: readonly Difficulty[] = ['novice', 'intermediate', 'advanced', 'expert'];
  const forms = new Set<string>();
  const terms: ReferenceTermInput[] = [];
  while (terms.length < size) {
    const lengthIndex = weightedPick(
      LENGTH_WEIGHTS.map(([, w]) => w),
      rng.int(0, lengthTotal),
    );
    const length = LENGTH_WEIGHTS[lengthIndex]?.[0] ?? 4;
    let form = '';
    for (let i = 0; i < length; i += 1) {
      form += String.fromCharCode(65 + weightedPick(letterWeights, rng.int(0, letterTotal)));
    }
    if (forms.has(form)) continue;
    forms.add(form);
    terms.push({
      ...term(form, difficulties[rng.int(0, 4)] ?? 'novice'),
      id: `t${String(terms.length)}`,
    });
  }
  const version = (size.toString(16).padStart(8, '0') + '00000000').slice(0, 16);
  return indexOf(version, TEST_PROFILE, terms, options);
}
