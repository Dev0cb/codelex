/**
 * The frozen lexicon GC-DET-01 replays on, built only from `replays/v1/gc-det-01.lexicon.json` with the rule its
 * `note` states (term i: id = lowercase form, difficulty = `difficultyCycle[i mod 4]`, the listed plural and
 * `related_to` relations, gameValue and knowledgeXp 1). Same construction as the engine's test fixture
 * (`packages/game-engine/test/support/gc-det-01-lexicon.ts`); fixture data, not rules. The log header pins the
 * resulting `lexiconVersion` and profile, so a drift here fails the replay with `LEXICON_MISMATCH` or a hash
 * difference, never a wrong pass.
 */
import {
  createReferenceIndex,
  type DefinitionHash,
  type Difficulty,
  type LexiconIndex,
  type LexiconVersion,
  type ReferenceTermInput,
} from '@codelex/lexicon/index';

/** The fields of `gc-det-01.lexicon.json` the construction reads. */
export interface FrozenLexicon {
  readonly version: string;
  readonly profile: { readonly id: string; readonly definitionHash: string };
  readonly difficultyCycle: readonly string[];
  readonly categories: readonly string[];
  readonly plurals: Readonly<Record<string, string>>;
  readonly relations: readonly (readonly string[])[];
  readonly forms: string;
}

export function frozenForms(frozen: FrozenLexicon): string[] {
  return frozen.forms.split(' ');
}

export function frozenLexicon(frozen: FrozenLexicon): LexiconIndex {
  const terms: ReferenceTermInput[] = frozenForms(frozen).map((form, i) => {
    const plural = frozen.plurals[form];
    return {
      id: form.toLowerCase(),
      playable: true,
      form,
      difficulty: (frozen.difficultyCycle[i % frozen.difficultyCycle.length] ??
        'novice') as Difficulty,
      categories: [...frozen.categories],
      inflections: plural === undefined ? [] : [{ form: plural, kind: 'plural' }],
      relations: frozen.relations
        .filter(([from]) => from === form)
        .map(([, to]) => ({ type: 'related_to', target: (to ?? '').toLowerCase() })),
      gameValue: 1,
      knowledgeXp: 1,
    };
  });
  return createReferenceIndex({
    version: frozen.version as LexiconVersion,
    profile: {
      id: frozen.profile.id,
      kind: 'global',
      definitionHash: frozen.profile.definitionHash as DefinitionHash,
    },
    document: { terms },
  });
}
