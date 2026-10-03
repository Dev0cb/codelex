import { describe, expect, it, vi } from 'vitest';

import { CATALOGS, checkCatalogs, type Catalog, type MessageKey } from './catalog.js';
import type { I18nError } from './errors.js';
import { DEFAULT_LOCALE, LOCALES, resolveLocale, textDirection, type Locale } from './locale.js';
import { createTranslator } from './translator.js';

const codes = (errors: readonly I18nError[]): string[] => errors.map((e) => e.code);

describe('shipped catalogs', () => {
  it('are valid: same keys, parseable, same arguments, naming convention, FR typography', () => {
    expect(checkCatalogs()).toEqual([]);
  });

  it('format every key in every locale without reporting an error', () => {
    const onError = vi.fn();
    const params = { version: 1, letter: 'A', points: 2 };
    for (const locale of LOCALES) {
      const { t } = createTranslator(locale, { onError });
      for (const key of Object.keys(CATALOGS.en) as MessageKey[]) {
        expect(t(key, params)).not.toBe(key);
      }
    }
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('createTranslator', () => {
  it('formats the app name and FR plurals from the real catalogs', () => {
    const en = createTranslator('en');
    const fr = createTranslator('fr');
    expect(en.t('app.name')).toBe('CODELEX');
    expect(fr.t('home.engine_version', { version: 1 })).toBe('Moteur de règles v1');
    expect(en.t('a11y.tile.letter', { letter: 'A', points: 1 })).toBe('Letter A, 1 point');
    expect(en.t('a11y.tile.letter', { letter: 'Z', points: 0 })).toBe('Letter Z, 0 points');
    expect(fr.t('a11y.tile.letter', { letter: 'Z', points: 0 })).toBe('Lettre Z, 0 point');
    expect(fr.t('a11y.tile.letter', { letter: 'K', points: 10 })).toBe('Lettre K, 10 points');
    expect(fr.direction).toBe('ltr');
    expect(fr.locale).toBe('fr');
  });

  it('falls back to English for a key missing in the locale, and reports it', () => {
    const errors: I18nError[] = [];
    const catalogs: Record<Locale, Catalog> = { en: { 'app.name': 'CODELEX' }, fr: {} };
    const { t } = createTranslator('fr', { catalogs, onError: (e) => errors.push(e) });
    expect(t('app.name')).toBe('CODELEX');
    expect(codes(errors)).toEqual(['MISSING_KEY']);
  });

  it('returns the key when it is missing everywhere, or when formatting fails', () => {
    const errors: I18nError[] = [];
    const catalogs: Record<Locale, Catalog> = { en: { 'a.b': '{x' }, fr: { 'a.b': '{x}' } };
    const en = createTranslator('en', { catalogs, onError: (e) => errors.push(e) });
    expect(en.t('app.name')).toBe('app.name');
    expect(en.t('a.b' as 'app.name')).toBe('a.b');
    expect(en.t('a.b' as 'app.name')).toBe('a.b'); // cached failure, reported once
    const fr = createTranslator('fr', { catalogs, onError: (e) => errors.push(e) });
    expect(fr.t('a.b' as 'app.name')).toBe('a.b'); // missing param
    expect(codes(errors)).toEqual(['MISSING_KEY', 'SYNTAX', 'MISSING_PARAM']);
    expect(errors[2]?.details).toEqual({ param: 'x', locale: 'fr', key: 'a.b' });
  });

  it('never throws without an error handler', () => {
    const { t } = createTranslator('en');
    expect(t('a11y.tile.letter')).toBe('a11y.tile.letter');
  });
});

describe('checkCatalogs', () => {
  it('reports every class of problem', () => {
    const problems = checkCatalogs({
      en: { 'a.one': '{n}', 'a.two': 'x', 'a.bad': '{', Bad: 'x', 'a.space': ' x' },
      fr: {
        'a.one': '{m}',
        'a.extra': 'x',
        'a.bad': 'x',
        'a.space': 'x',
        'a.two': 'Quoi ?',
      },
    });
    expect(problems.map((p) => [p.code, p.details?.['locale'], p.details?.['key']])).toEqual([
      ['CATALOG_MISMATCH', undefined, 'Bad'],
      ['SYNTAX', 'en', 'a.bad'],
      ['TYPOGRAPHY', 'en', 'a.space'],
      ['MISSING_KEY', 'fr', 'Bad'],
      ['CATALOG_MISMATCH', 'fr', 'a.extra'],
      ['CATALOG_MISMATCH', 'fr', 'a.one'],
      ['TYPOGRAPHY', 'fr', 'a.two'],
    ]);
  });
});

describe('locales', () => {
  it('resolves device preferences on the language subtag, defaulting to English', () => {
    expect(resolveLocale(['fr-FR', 'en-US'])).toBe('fr');
    expect(resolveLocale(['FR_ca'])).toBe('fr');
    expect(resolveLocale(['de-DE', 'en-GB'])).toBe('en');
    expect(resolveLocale(['de-DE'])).toBe(DEFAULT_LOCALE);
    expect(resolveLocale([])).toBe(DEFAULT_LOCALE);
    expect(resolveLocale([''])).toBe(DEFAULT_LOCALE);
  });

  it('exposes the text direction', () => {
    expect(LOCALES.map(textDirection)).toEqual(['ltr', 'ltr']);
  });
});
