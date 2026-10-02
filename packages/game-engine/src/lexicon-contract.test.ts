import type { FormRef, LexiconIndex, TermMeta, TermRef } from '@codelex/lexicon/index';
import { describe, expectTypeOf, it } from 'vitest';

/**
 * Consumer-side guard for game-engine-api note §5: `@codelex/lexicon/index` resolves from this package and
 * provides the `EngineLexicon` members with the FormRef/TermRef split (sprint L2). E2 defines the real
 * `EngineLexicon` type in src/; this test only fails early if the lexicon contract drifts.
 */
describe('@codelex/lexicon/index contract used by the engine', () => {
  it('provides lookup → FormRef, termOf → TermRef, meta(TermRef).form', () => {
    type EngineLexicon = Pick<
      LexiconIndex,
      | 'version'
      | 'profile'
      | 'lookup'
      | 'lookupCodes'
      | 'termOf'
      | 'meta'
      | 'difficulty'
      | 'related'
    >;
    expectTypeOf<EngineLexicon['lookup']>().returns.toEqualTypeOf<FormRef | undefined>();
    expectTypeOf<EngineLexicon['lookupCodes']>().returns.toEqualTypeOf<FormRef | undefined>();
    expectTypeOf<EngineLexicon['termOf']>().toEqualTypeOf<(form: FormRef) => TermRef>();
    expectTypeOf<EngineLexicon['meta']>().toEqualTypeOf<(term: TermRef) => TermMeta>();
    expectTypeOf<TermMeta['form']>().toBeString();
    expectTypeOf<EngineLexicon['profile']['definitionHash']>().toBeString();
  });
});
