/**
 * The G-LEX-SMALL stub lexicon of RULE_PROPERTIES §3.1 and §3.2, which the `scoring/v1` golden cases are scored
 * on. Transcribed term for term from the engine's golden scoring test (`packages/game-engine/src/scoring/
 * score.test.ts`, `STUB`): same forms, difficulties, inflections, relations, version and profile. Fixture data,
 * not rules: a drift here makes the `scoring/v1` cases fail on every runtime, never pass wrongly.
 */
import {
  createReferenceIndex,
  type DefinitionHash,
  type Difficulty,
  type LexiconIndex,
  type LexiconVersion,
  type ReferenceTermInput,
} from '@codelex/lexicon/index';

function stubTerm(
  form: string,
  difficulty: Difficulty,
  extra: Partial<Pick<ReferenceTermInput, 'inflections' | 'relations'>> = {},
): ReferenceTermInput {
  return {
    id: form.toLowerCase(),
    playable: true,
    form,
    difficulty,
    categories: ['cloud'],
    inflections: extra.inflections ?? [],
    relations: extra.relations ?? [],
    gameValue: 1,
    knowledgeXp: 1,
  };
}

export function scoringLexicon(): LexiconIndex {
  return createReferenceIndex({
    version: '1111111111111111' as LexiconVersion,
    profile: {
      id: 'global-ranked',
      kind: 'global',
      definitionHash: '2222222222222222' as DefinitionHash,
    },
    document: {
      terms: [
        stubTerm('AI', 'novice'),
        stubTerm('API', 'novice'),
        stubTerm('CI', 'intermediate'),
        stubTerm('CLOUD', 'novice'),
        stubTerm('CLOUDFLARE', 'advanced'),
        stubTerm('BUCKET', 'intermediate', { relations: [{ type: 'part_of', target: 'cloud' }] }),
        stubTerm('CHATBOT', 'novice'),
        stubTerm('CPU', 'novice'),
        stubTerm('ETL', 'advanced'),
        stubTerm('GO', 'intermediate'),
        stubTerm('JSON', 'intermediate'),
        stubTerm('KUBERNETES', 'expert'),
        stubTerm('NAT', 'advanced'),
        stubTerm('PYTHON', 'intermediate'),
        stubTerm('TCP', 'intermediate'),
        stubTerm('ZERODAY', 'expert'),
        stubTerm('POD', 'advanced', {
          inflections: [{ form: 'PODS', kind: 'plural' }],
          relations: [{ type: 'part_of', target: 'kubernetes' }],
        }),
        stubTerm('SQL', 'intermediate'),
      ],
    },
  });
}
