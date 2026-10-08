import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { normalizeLocale } from './envelope';
import { LOCALE_PATTERN } from './events';

describe('normalizeLocale', () => {
  it('keeps language, script and region and drops everything else', () => {
    expect(normalizeLocale('fr-SN')).toBe('fr-SN');
    expect(normalizeLocale('en_us')).toBe('en-US');
    expect(normalizeLocale('zh-hant-tw')).toBe('zh-Hant-TW');
    expect(normalizeLocale('es-419')).toBe('es-419');
    expect(normalizeLocale('en-US-u-fw-mon')).toBe('en-US');
    expect(normalizeLocale('de-x-private')).toBe('de');
  });

  it('falls back to und without a language subtag', () => {
    expect(normalizeLocale(undefined)).toBe('und');
    expect(normalizeLocale('')).toBe('und');
    expect(normalizeLocale('1234-US')).toBe('und');
  });

  it('always yields a value the event schema accepts (property)', () => {
    fc.assert(
      fc.property(fc.string(), (tag) => {
        expect(LOCALE_PATTERN.test(normalizeLocale(tag))).toBe(true);
      }),
    );
  });
});
