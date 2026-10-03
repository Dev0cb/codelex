/**
 * The frozen lexicon GC-DET-01 replays on (review R1 n6). Built only from
 * `test/golden/replays/v1/gc-det-01.lexicon.json`, so edits to the harness vocabulary of `play.ts` can never change
 * the golden replay. Same `lexiconVersion` and profile as the harness: the log header pins them.
 */
import {
  createReferenceIndex,
  type DefinitionHash,
  type LexiconIndex,
  type LexiconVersion,
  type ReferenceTermInput,
} from '@codelex/lexicon/index';
import frozen from '../golden/replays/v1/gc-det-01.lexicon.json' with { type: 'json' };
import type { EngineContext } from '../../src/types.js';

/** Every form of the frozen list, in term order (the order fixes each term's difficulty). */
export const GC_DET_01_FORMS: readonly string[] = frozen.forms.split(' ');

const plurals: Readonly<Record<string, string>> = frozen.plurals;

export function gcDet01Terms(): ReferenceTermInput[] {
  return GC_DET_01_FORMS.map((form, i) => {
    const plural = plurals[form];
    return {
      id: form.toLowerCase(),
      playable: true,
      form,
      difficulty: frozen.difficultyCycle[i % frozen.difficultyCycle.length] ?? 'novice',
      categories: frozen.categories,
      inflections: plural === undefined ? [] : [{ form: plural, kind: 'plural' }],
      relations: frozen.relations
        .filter(([from]) => from === form)
        .map(([, to]) => ({ type: 'related_to', target: (to ?? '').toLowerCase() })),
      gameValue: 1,
      knowledgeXp: 1,
    };
  });
}

export function gcDet01Lexicon(): LexiconIndex {
  return createReferenceIndex({
    version: frozen.version as LexiconVersion,
    profile: {
      id: frozen.profile.id,
      kind: 'global',
      definitionHash: frozen.profile.definitionHash as DefinitionHash,
    },
    document: { terms: gcDet01Terms() },
  });
}

export const GC_DET_01_CTX: EngineContext = { lexicon: gcDet01Lexicon() };
