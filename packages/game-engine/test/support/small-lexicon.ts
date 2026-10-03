/**
 * G-LEX-SMALL (RULE_PROPERTIES §4): a tiny fixed lexicon built with the lexicon's reference index (sprint L3),
 * so engine tests run against the real `LexiconIndex` contract, not a hand-rolled fake.
 */
import {
  createReferenceIndex,
  type DefinitionHash,
  type LexiconIndex,
  type LexiconVersion,
  type ReferenceTermInput,
} from '@codelex/lexicon/index';
import type { EngineContext, MatchConfig, SeedHex } from '../../src/types.js';

type Difficulty = 'novice' | 'intermediate' | 'advanced' | 'expert';

function term(
  id: string,
  form: string,
  difficulty: Difficulty,
  extra: Partial<Pick<ReferenceTermInput, 'inflections' | 'relations' | 'categories'>> = {},
): ReferenceTermInput {
  return {
    id,
    playable: true,
    form,
    difficulty,
    categories: extra.categories ?? ['networking'],
    inflections: extra.inflections ?? [],
    relations: extra.relations ?? [],
    gameValue: 1,
    knowledgeXp: 1,
  };
}

export const SMALL_TERMS: readonly ReferenceTermInput[] = [
  term('ai', 'AI', 'novice', { categories: ['ai'] }),
  term('ad', 'AD', 'novice'),
  term('cd', 'CD', 'intermediate', { categories: ['devops'] }),
  term('cdn', 'CDN', 'advanced'),
  term('dns', 'DNS', 'intermediate'),
  term('ip', 'IP', 'novice'),
  term('tcp', 'TCP', 'intermediate', { relations: [{ type: 'uses', target: 'ip' }] }),
  term('udp', 'UDP', 'intermediate', { relations: [{ type: 'uses', target: 'ip' }] }),
  term('pod', 'POD', 'advanced', {
    categories: ['devops', 'cloud'],
    inflections: [{ form: 'PODS', kind: 'plural' }],
    relations: [{ type: 'part_of', target: 'kubernetes' }],
  }),
  term('kubernetes', 'KUBERNETES', 'expert', { categories: ['devops', 'cloud'] }),
  term('api', 'API', 'novice', { categories: ['web'] }),
  term('git', 'GIT', 'novice', { categories: ['devops'] }),
];

export const SMALL_VERSION = '0123456789abcdef' as LexiconVersion;
export const SMALL_PROFILE = {
  id: 'global-ranked',
  kind: 'global',
  definitionHash: 'fedcba9876543210' as DefinitionHash,
} as const;

export function smallLexicon(
  version: LexiconVersion = SMALL_VERSION,
  definitionHash: DefinitionHash = SMALL_PROFILE.definitionHash,
): LexiconIndex {
  return createReferenceIndex({
    version,
    profile: { ...SMALL_PROFILE, definitionHash },
    document: { terms: SMALL_TERMS },
  });
}

export const CTX: EngineContext = { lexicon: smallLexicon() };

/** A valid 1v1 config pinned to the small lexicon. */
export function config1v1(
  seed = '00c0de1e00000001',
  overrides: Partial<MatchConfig> = {},
): MatchConfig {
  return {
    seed: seed as SeedHex,
    engineRulesVersion: 1,
    lexiconVersion: SMALL_VERSION,
    profileId: SMALL_PROFILE.id,
    definitionHash: SMALL_PROFILE.definitionHash,
    config: {
      mode: 'classic',
      format: 'untimed-vs-bot',
      seats: 2,
      teams: [[0], [1]],
      layout: 'classic-v1',
      letters: 'letters-v1',
      requireWinner: 0,
    },
    ...overrides,
  };
}

/** A 15×15 board from sparse `(row, col, tile)` entries. */
export function boardWith(entries: readonly (readonly [number, number, string])[]): string[] {
  const rows = new Array<string>(15).fill('.'.repeat(15));
  for (const [row, col, tile] of entries) {
    const line = rows[row] ?? '';
    rows[row] = line.slice(0, col) + tile + line.slice(col + 1);
  }
  return rows;
}

/** Board entries spelling `word` from `(row, col)` along a direction. */
export function spell(
  word: string,
  row: number,
  col: number,
  direction: 'row' | 'col' = 'row',
): [number, number, string][] {
  return Array.from({ length: word.length }, (_, i) => word.charAt(i)).map((tile, i) =>
    direction === 'row' ? [row, col + i, tile] : [row + i, col, tile],
  );
}
