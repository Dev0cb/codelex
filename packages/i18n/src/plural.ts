import type { Locale } from './locale.js';

/** CLDR plural categories. */
export const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;
export type PluralCategory = (typeof PLURAL_CATEGORIES)[number];

export function isPluralCategory(value: string): value is PluralCategory {
  return (PLURAL_CATEGORIES as readonly string[]).includes(value);
}

/** Fraction digits kept before selecting, as `Intl.NumberFormat` and `Intl.PluralRules` do by default. */
const MAX_FRACTION_DIGITS = 3;
const FRACTION_SCALE = 1000;

interface Operands {
  /** Integer digits of the absolute value. */
  readonly i: number;
  /** Number of visible fraction digits. */
  readonly v: number;
}

function operands(n: number): Operands {
  const abs = Math.round(Math.abs(n) * FRACTION_SCALE) / FRACTION_SCALE;
  const text = String(abs);
  const dot = text.indexOf('.');
  let v = 0;
  if (text.includes('e')) v = Number.isInteger(abs) ? 0 : MAX_FRACTION_DIGITS;
  else if (dot >= 0) v = text.length - dot - 1;
  return { i: Math.trunc(abs), v };
}

/**
 * CLDR plural rules (CLDR 46) for the shipped locales, so that formatting never depends on `Intl.PluralRules`,
 * which Hermes does not implement (docs/architecture/notes/mobile-app-foundation.md §4). A test pins parity with
 * `Intl.PluralRules` on Node. The compact-exponent operand `e` is always 0: messages never use compact numbers.
 *
 * - en: one = `i = 1 and v = 0`; other.
 * - fr: one = `i = 0,1`; many = `e = 0 and i != 0 and i % 1000000 = 0 and v = 0`; other.
 */
export function pluralCategory(locale: Locale, n: number): PluralCategory {
  const { i, v } = operands(n);
  switch (locale) {
    case 'en':
      return i === 1 && v === 0 ? 'one' : 'other';
    case 'fr':
      if (i === 0 || i === 1) return 'one';
      if (i % 1_000_000 === 0 && v === 0) return 'many';
      return 'other';
  }
}
