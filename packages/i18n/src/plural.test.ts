import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { LOCALES } from './locale.js';
import { pluralCategory } from './plural.js';

describe('pluralCategory', () => {
  it('follows CLDR for English', () => {
    expect(pluralCategory('en', 0)).toBe('other');
    expect(pluralCategory('en', 1)).toBe('one');
    expect(pluralCategory('en', -1)).toBe('one');
    expect(pluralCategory('en', 1.5)).toBe('other');
    expect(pluralCategory('en', 2)).toBe('other');
  });

  it('follows CLDR for French: 0 and 1 are singular, exact millions are "many"', () => {
    expect(pluralCategory('fr', 0)).toBe('one');
    expect(pluralCategory('fr', 1)).toBe('one');
    expect(pluralCategory('fr', 1.5)).toBe('one');
    expect(pluralCategory('fr', 2)).toBe('other');
    expect(pluralCategory('fr', 1_000_000)).toBe('many');
    expect(pluralCategory('fr', 2_000_000)).toBe('many');
    expect(pluralCategory('fr', 1_000_000.5)).toBe('other');
    expect(pluralCategory('fr', 1_000_001)).toBe('other');
  });

  it('handles numbers printed with an exponent', () => {
    expect(pluralCategory('en', 1e21)).toBe('other');
    expect(pluralCategory('fr', 1e21)).toBe('many');
    expect(pluralCategory('fr', 2e21 + 0.5)).toBe('many');
  });

  // Parity with the platform implementation we replace (Hermes has no Intl.PluralRules; Node does).
  it.each(LOCALES)('matches Intl.PluralRules for %s on integers', (locale) => {
    const rules = new Intl.PluralRules(locale);
    fc.assert(
      fc.property(fc.integer({ min: -10_000_000, max: 10_000_000 }), (n) => {
        expect(pluralCategory(locale, n)).toBe(rules.select(n));
      }),
    );
    for (const n of [0, 1, 2, 1_000_000, 3_000_000, 10_000_000]) {
      expect(pluralCategory(locale, n)).toBe(rules.select(n));
    }
  });

  it.each(LOCALES)('matches Intl.PluralRules for %s on decimals with up to 3 digits', (locale) => {
    const rules = new Intl.PluralRules(locale);
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 5_000_000 }),
        fc.constantFrom(10, 100, 1000),
        (k, d) => {
          const n = k / d;
          expect(pluralCategory(locale, n)).toBe(rules.select(n));
        },
      ),
    );
  });
});
