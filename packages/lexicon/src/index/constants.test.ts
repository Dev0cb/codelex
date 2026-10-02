import { readFileSync } from 'node:fs';

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  DIFFICULTIES,
  FORM_KINDS,
  GADDAG_SEPARATOR,
  INFLECTION_KINDS,
  LETTER_COUNT,
  MAX_FORM_LENGTH,
  RELATION_TYPES,
  hasRelation,
  isDefinitionHash,
  isLexiconVersion,
  relationBit,
  relationTypesOf,
} from './constants.js';
import type {
  DefinitionHash,
  Difficulty,
  FormKind,
  InflectionKind,
  LexiconVersion,
  RelationType,
} from './types.js';

interface EnumNode {
  readonly enum?: readonly string[];
  readonly pattern?: string;
}
interface TermSchema {
  readonly $defs: {
    readonly term: {
      readonly properties: {
        readonly form: EnumNode;
        readonly difficulty: EnumNode;
        readonly inflections: { readonly items: { readonly properties: { kind: EnumNode } } };
        readonly relations: { readonly items: { readonly properties: { type: EnumNode } } };
      };
    };
  };
}

const schema = JSON.parse(
  readFileSync(new URL('../../schema/term.schema.json', import.meta.url), 'utf8'),
) as TermSchema;
const term = schema.$defs.term.properties;

describe('constants mirror schema/term.schema.json (no drift)', () => {
  it('DIFFICULTIES = difficulty enum', () => {
    expect(DIFFICULTIES).toEqual(term.difficulty.enum);
  });

  it('RELATION_TYPES = relation type enum (bit order)', () => {
    expect(RELATION_TYPES).toEqual(term.relations.items.properties.type.enum);
  });

  it('INFLECTION_KINDS = inflection kind enum; FORM_KINDS = canonical + kinds', () => {
    expect(INFLECTION_KINDS).toEqual(term.inflections.items.properties.kind.enum);
    expect(FORM_KINDS).toEqual(['canonical', ...INFLECTION_KINDS]);
  });

  it('MAX_FORM_LENGTH and LETTER_COUNT match the form pattern', () => {
    expect(term.form.pattern).toBe(`^[A-Z]{2,${String(MAX_FORM_LENGTH)}}$`);
    expect(LETTER_COUNT).toBe(26);
    expect(GADDAG_SEPARATOR).toBe(LETTER_COUNT);
  });

  it('the arrays are frozen and cover their union types exactly', () => {
    for (const list of [DIFFICULTIES, RELATION_TYPES, INFLECTION_KINDS, FORM_KINDS]) {
      expect(Object.isFrozen(list)).toBe(true);
    }
    expectTypeOf<(typeof DIFFICULTIES)[number]>().toEqualTypeOf<Difficulty>();
    expectTypeOf<(typeof RELATION_TYPES)[number]>().toEqualTypeOf<RelationType>();
    expectTypeOf<(typeof INFLECTION_KINDS)[number]>().toEqualTypeOf<InflectionKind>();
    expectTypeOf<(typeof FORM_KINDS)[number]>().toEqualTypeOf<FormKind>();
    expect(new Set(RELATION_TYPES).size).toBe(RELATION_TYPES.length);
  });
});

describe('isLexiconVersion', () => {
  it('accepts 16 lowercase hex chars (the validate.mjs output format)', () => {
    expect(isLexiconVersion('2f2cc6fca8fac92b')).toBe(true);
  });

  it.each(['', '2f2cc6fca8fac92', '2f2cc6fca8fac92b0', '2F2CC6FCA8FAC92B', '2f2cc6fca8fac92g'])(
    'rejects %j',
    (value) => {
      expect(isLexiconVersion(value)).toBe(false);
    },
  );

  it('narrows to the brand', () => {
    const value: string = '2f2cc6fca8fac92b';
    if (isLexiconVersion(value)) expectTypeOf(value).toEqualTypeOf<LexiconVersion>();
  });
});

describe('constant arrays keep their tuple types (satisfies, not widening)', () => {
  it('exposes literal positions and lengths', () => {
    expectTypeOf(DIFFICULTIES).toEqualTypeOf<
      readonly ['novice', 'intermediate', 'advanced', 'expert']
    >();
    expectTypeOf(RELATION_TYPES[0]).toEqualTypeOf<'is_a'>();
    expectTypeOf(RELATION_TYPES.length).toEqualTypeOf<7>();
    expectTypeOf(INFLECTION_KINDS.length).toEqualTypeOf<4>();
    expectTypeOf(FORM_KINDS[0]).toEqualTypeOf<'canonical'>();
    expectTypeOf(FORM_KINDS.length).toEqualTypeOf<5>();
  });
});

describe('isDefinitionHash', () => {
  it('accepts 16 lowercase hex chars and narrows to the brand', () => {
    const value: string = '0123456789abcdef';
    expect(isDefinitionHash(value)).toBe(true);
    if (isDefinitionHash(value)) expectTypeOf(value).toEqualTypeOf<DefinitionHash>();
  });

  it.each(['', '0123456789abcde', '0123456789ABCDEF', 'global-ranked'])('rejects %j', (value) => {
    expect(isDefinitionHash(value)).toBe(false);
  });
});

describe('relation masks', () => {
  it('bit k is RELATION_TYPES[k]', () => {
    RELATION_TYPES.forEach((type, k) => {
      expect(relationBit(type)).toBe(1 << k);
    });
    expect(relationBit('is_a')).toBe(1);
    expect(relationBit('implements')).toBe(64);
  });

  it('hasRelation and relationTypesOf decode a mask deterministically', () => {
    const mask = relationBit('uses') | relationBit('is_a');
    expect(hasRelation(mask, 'uses')).toBe(true);
    expect(hasRelation(mask, 'part_of')).toBe(false);
    expect(hasRelation(0, 'is_a')).toBe(false);
    expect(relationTypesOf(mask)).toEqual(['is_a', 'uses']);
    expect(relationTypesOf(0)).toEqual([]);
    expect(relationTypesOf(1 << 20)).toEqual([]);
    expect(relationTypesOf(0x7f)).toEqual(RELATION_TYPES);
  });

  it('relationBit throws a RangeError for a type outside RELATION_TYPES (never the sign bit)', () => {
    const unknown = 'depends_on' as RelationType;
    expect(() => relationBit(unknown)).toThrow(RangeError);
    expect(() => relationBit(unknown)).toThrow(/depends_on/);
  });

  it('hasRelation is false for an unknown type, even on a mask with every bit set', () => {
    const unknown = 'depends_on' as RelationType;
    expect(hasRelation(-1, unknown)).toBe(false);
    expect(hasRelation(0x7f, unknown)).toBe(false);
    expect(hasRelation(1 << 31, unknown)).toBe(false);
  });
});
