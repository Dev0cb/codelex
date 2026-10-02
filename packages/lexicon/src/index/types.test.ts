import type { Result } from '@codelex/config/result';
import { describe, expectTypeOf, it } from 'vitest';

import type {
  CategoryId,
  DecodeLexiconIndex,
  DefinitionHash,
  Difficulty,
  FormKind,
  FormMeta,
  FormRef,
  Gaddag,
  GaddagNode,
  LetterCounts,
  LetterMask,
  LexiconIndex,
  LexiconIndexError,
  LexiconIndexErrorCode,
  LexiconProfileRef,
  LexiconVersion,
  RelationMask,
  TermMeta,
  TermRef,
} from './index.js';
import { decodeLexiconIndex } from './index.js';

/**
 * Type-level contract tests. They are checked by `tsc --noEmit` (typecheck task, tests are in tsconfig) and
 * `@ts-expect-error` lines fail the typecheck if a brand stops rejecting a plain value.
 */

/** game-engine-api note §5: the members the engine uses. */
type EngineLexicon = Pick<
  LexiconIndex,
  'version' | 'profile' | 'lookup' | 'lookupCodes' | 'termOf' | 'meta' | 'difficulty' | 'related'
>;

describe('branded refs', () => {
  it('FormRef, TermRef, GaddagNode, LexiconVersion and CategoryId are not interchangeable', () => {
    expectTypeOf<FormRef>().toExtend<number>();
    expectTypeOf<TermRef>().toExtend<number>();
    expectTypeOf<GaddagNode>().toExtend<number>();
    expectTypeOf<LexiconVersion>().toExtend<string>();
    expectTypeOf<CategoryId>().toExtend<string>();

    expectTypeOf<number>().not.toExtend<FormRef>();
    expectTypeOf<number>().not.toExtend<TermRef>();
    expectTypeOf<FormRef>().not.toExtend<TermRef>();
    expectTypeOf<TermRef>().not.toExtend<FormRef>();
    expectTypeOf<GaddagNode>().not.toExtend<TermRef>();
    expectTypeOf<string>().not.toExtend<LexiconVersion>();
    expectTypeOf<string>().not.toExtend<CategoryId>();
    expectTypeOf<CategoryId>().not.toExtend<LexiconVersion>();
  });

  it('rejects plain numbers and swapped refs at call sites', () => {
    const typeOnly = (index: LexiconIndex): void => {
      const form = index.lookup('PODS');
      if (form === undefined) return;
      const term = index.termOf(form);
      index.meta(term);
      // @ts-expect-error a FormRef is not a TermRef: resolve it with termOf first
      index.meta(form);
      // @ts-expect-error a TermRef is not a FormRef
      index.termOf(term);
      // @ts-expect-error plain numbers are not refs
      index.difficulty(0);
      // @ts-expect-error plain strings are not category ids
      index.inCategory(term, 'cloud');
    };
    expectTypeOf(typeOnly).toBeFunction();
  });
});

describe('LexiconIndex (lexicon-index note §2.2, E-1.7 split)', () => {
  it('lookup / lookupCodes return FormRef | undefined; has returns boolean', () => {
    expectTypeOf<LexiconIndex['has']>().toEqualTypeOf<(form: string) => boolean>();
    expectTypeOf<LexiconIndex['lookup']>().toEqualTypeOf<(form: string) => FormRef | undefined>();
    expectTypeOf<LexiconIndex['lookupCodes']>().toEqualTypeOf<
      (codes: ArrayLike<number>, from: number, to: number) => FormRef | undefined
    >();
  });

  it('termOf maps FormRef to TermRef; formMeta exposes the played form and its kind', () => {
    expectTypeOf<LexiconIndex['termOf']>().toEqualTypeOf<(form: FormRef) => TermRef>();
    expectTypeOf<LexiconIndex['formMeta']>().toEqualTypeOf<(form: FormRef) => FormMeta>();
    expectTypeOf<FormMeta>().toEqualTypeOf<{
      readonly ref: FormRef;
      readonly form: string;
      readonly term: TermRef;
      readonly kind: FormKind;
    }>();
    expectTypeOf<FormKind>().toEqualTypeOf<
      'canonical' | 'plural' | 'verb_s' | 'verb_ed' | 'verb_ing'
    >();
  });

  it('term-level accessors take TermRef', () => {
    expectTypeOf<LexiconIndex['meta']>().toEqualTypeOf<(term: TermRef) => TermMeta>();
    expectTypeOf<LexiconIndex['difficulty']>().toEqualTypeOf<(term: TermRef) => Difficulty>();
    expectTypeOf<LexiconIndex['inCategory']>().toEqualTypeOf<
      (term: TermRef, category: CategoryId) => boolean
    >();
    expectTypeOf<LexiconIndex['related']>().toEqualTypeOf<
      (a: TermRef, b: TermRef) => RelationMask
    >();
    expectTypeOf<LexiconIndex['neighbours']>().toEqualTypeOf<
      (term: TermRef) => readonly TermRef[]
    >();
    expectTypeOf<LexiconIndex['categories']>().toEqualTypeOf<() => readonly CategoryId[]>();
    expectTypeOf<LexiconIndex['letterCounts']>().toEqualTypeOf<() => LetterCounts>();
    expectTypeOf<LexiconIndex['crossCheck']>().toEqualTypeOf<
      (before: ArrayLike<number>, after: ArrayLike<number>) => LetterMask
    >();
  });

  it('TermMeta carries the canonical form, id and scoring metadata', () => {
    expectTypeOf<TermMeta>().toEqualTypeOf<{
      readonly ref: TermRef;
      readonly id: string;
      readonly form: string;
      readonly difficulty: Difficulty;
      readonly categories: readonly CategoryId[];
      readonly gameValue: number;
      readonly knowledgeXp: number;
    }>();
  });

  it('identity fields pin the artefact (ADR-0013 Q-G1)', () => {
    expectTypeOf<LexiconIndex['version']>().toEqualTypeOf<LexiconVersion>();
    expectTypeOf<LexiconIndex['profile']>().toEqualTypeOf<LexiconProfileRef>();
    expectTypeOf<LexiconProfileRef>().toEqualTypeOf<{
      readonly id: string;
      readonly kind: 'global' | 'season' | 'org';
      readonly definitionHash: DefinitionHash;
    }>();
    expectTypeOf<DefinitionHash>().toExtend<string>();
    expectTypeOf<string>().not.toExtend<DefinitionHash>();
    expectTypeOf<DefinitionHash>().not.toExtend<LexiconVersion>();
    expectTypeOf<LexiconVersion>().not.toExtend<DefinitionHash>();
    expectTypeOf<LexiconIndex['size']>().toBeNumber();
    expectTypeOf<LexiconIndex['termCount']>().toBeNumber();
    expectTypeOf<LexiconIndex['formatVersion']>().toBeNumber();
    expectTypeOf<LexiconIndex['maxFormLength']>().toBeNumber();
    expectTypeOf<LexiconIndex['gaddag']>().toEqualTypeOf<Gaddag | undefined>();
  });

  it('provides every EngineLexicon member of game-engine-api note §5', () => {
    expectTypeOf<keyof EngineLexicon>().toEqualTypeOf<
      | 'version'
      | 'profile'
      | 'lookup'
      | 'lookupCodes'
      | 'termOf'
      | 'meta'
      | 'difficulty'
      | 'related'
    >();
    expectTypeOf<LexiconIndex>().toExtend<EngineLexicon>();
  });

  it('is read-only', () => {
    const typeOnly = (index: LexiconIndex): void => {
      // @ts-expect-error identity fields are readonly
      index.version = index.version;
      // @ts-expect-error meta objects are readonly
      index.meta(index.termOf(index.lookup('POD') as FormRef)).form = 'PODS';
    };
    expectTypeOf(typeOnly).toBeFunction();
  });
});

describe('letterCounts (read-only contract)', () => {
  it('exposes no mutators, and a Uint32Array copy or a frozen number array satisfies it', () => {
    expectTypeOf<LetterCounts>().toEqualTypeOf<ArrayLike<number> & Iterable<number>>();
    expectTypeOf<Uint32Array>().toExtend<LetterCounts>();
    expectTypeOf<readonly number[]>().toExtend<LetterCounts>();
    expectTypeOf<LetterCounts>().not.toHaveProperty('set');
    expectTypeOf<LetterCounts>().not.toHaveProperty('fill');
    expectTypeOf<LetterCounts>().not.toHaveProperty('copyWithin');
    expectTypeOf<LetterCounts>().not.toHaveProperty('reverse');
    expectTypeOf<LetterCounts>().not.toHaveProperty('sort');
    const typeOnly = (counts: LetterCounts): void => {
      // @ts-expect-error elements are read-only (ArrayLike index signature)
      counts[0] = 1;
    };
    expectTypeOf(typeOnly).toBeFunction();
  });
});

describe('Gaddag (lexicon-index note §2.3)', () => {
  it('has the traversal signatures', () => {
    expectTypeOf<Gaddag['root']>().toEqualTypeOf<GaddagNode>();
    expectTypeOf<Gaddag['arcs']>().toEqualTypeOf<(node: GaddagNode) => number>();
    expectTypeOf<Gaddag['next']>().toEqualTypeOf<
      (node: GaddagNode, symbol: number) => GaddagNode | -1
    >();
    expectTypeOf<Gaddag['isFinal']>().toEqualTypeOf<(node: GaddagNode) => boolean>();
  });
});

describe('errors and decoder', () => {
  it('LexiconIndexError is a typed domain error', () => {
    expectTypeOf<LexiconIndexErrorCode>().toEqualTypeOf<
      | 'BAD_MAGIC'
      | 'UNSUPPORTED_FORMAT'
      | 'TRUNCATED'
      | 'CORRUPT'
      | 'VERSION_MISMATCH'
      | 'PROFILE_MISMATCH'
      | 'UNSUPPORTED_PLATFORM'
    >();
    expectTypeOf<LexiconIndexError>().toEqualTypeOf<{
      readonly code: LexiconIndexErrorCode;
      readonly message: string;
      readonly details?: Readonly<Record<string, string | number>>;
    }>();
  });

  it('decodeLexiconIndex(bytes, expect?) returns Result<LexiconIndex, LexiconIndexError>', () => {
    expectTypeOf(decodeLexiconIndex).toEqualTypeOf<DecodeLexiconIndex>();
    expectTypeOf(decodeLexiconIndex).parameter(0).toEqualTypeOf<Uint8Array>();
    expectTypeOf(decodeLexiconIndex)
      .parameter(1)
      .toEqualTypeOf<
        { readonly version?: LexiconVersion; readonly profileId?: string } | undefined
      >();
    expectTypeOf(decodeLexiconIndex).returns.toEqualTypeOf<
      Result<LexiconIndex, LexiconIndexError>
    >();
  });
});
