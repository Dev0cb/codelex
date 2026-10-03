import en from './catalogs/en.json' with { type: 'json' };
import fr from './catalogs/fr.json' with { type: 'json' };
import { i18nError, type I18nError } from './errors.js';
import { LOCALES, type Locale } from './locale.js';
import { argumentNames, parseMessage } from './message.js';

/** Every message key. English is the reference catalog: its keys define the type. */
export type MessageKey = keyof typeof en;

export type Catalog = Readonly<Record<string, string>>;

export const CATALOGS: Readonly<Record<Locale, Catalog>> = { en, fr };

/** Key naming convention (README): dot-separated lower snake_case segments, `<surface>.<element>[.<variant>]`. */
export const KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9][a-z0-9_]*)+$/;

/**
 * French typography (E-1.5 D-19): no plain space before `; ! ?` (U+202F) or `:` (U+00A0), no plain space inside
 * « ». Text inside `{…}` arguments is checked too, which is what we want (plural branches are copy).
 */
const FR_TYPOGRAPHY = [/ [;!?:»]/, /« /];

const keysOf = (catalog: Catalog): string[] =>
  Object.keys(catalog).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * Validates every catalog against the reference (EN): same keys, every message parses, same argument names per
 * key, key naming convention, FR typography. Returns every problem found (empty = valid). Run by the tests, so CI
 * fails on a broken catalog.
 */
export function checkCatalogs(catalogs: Readonly<Record<Locale, Catalog>> = CATALOGS): I18nError[] {
  const problems: I18nError[] = [];
  const reference = keysOf(catalogs.en);
  for (const key of reference) {
    if (!KEY_PATTERN.test(key)) {
      problems.push(
        i18nError('CATALOG_MISMATCH', 'key does not follow the naming convention', { key }),
      );
    }
  }
  for (const locale of LOCALES) {
    const catalog = catalogs[locale];
    const keys = keysOf(catalog);
    for (const key of reference) {
      if (!Object.hasOwn(catalog, key)) {
        problems.push(i18nError('MISSING_KEY', 'key missing from catalog', { locale, key }));
      }
    }
    for (const key of keys) {
      if (!Object.hasOwn(catalogs.en, key)) {
        problems.push(
          i18nError('CATALOG_MISMATCH', 'key not in the reference catalog', { locale, key }),
        );
        continue;
      }
      const source = catalog[key] ?? '';
      const parsed = parseMessage(source);
      if (!parsed.ok) {
        problems.push({ ...parsed.error, details: { ...parsed.error.details, locale, key } });
        continue;
      }
      const expected = parseMessage(catalogs.en[key] ?? '');
      if (
        expected.ok &&
        argumentNames(expected.value).join(',') !== argumentNames(parsed.value).join(',')
      ) {
        problems.push(
          i18nError('CATALOG_MISMATCH', 'arguments differ from the reference', { locale, key }),
        );
      }
      if (source !== source.trim()) {
        problems.push(i18nError('TYPOGRAPHY', 'leading or trailing whitespace', { locale, key }));
      }
      if (locale === 'fr' && FR_TYPOGRAPHY.some((re) => re.test(source))) {
        problems.push(
          i18nError('TYPOGRAPHY', 'use U+202F before ; ! ? and U+00A0 before : and inside « »', {
            locale,
            key,
          }),
        );
      }
    }
  }
  return problems;
}
