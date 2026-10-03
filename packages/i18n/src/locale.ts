/** Locales shipped in the app (CLAUDE.md §1.6: EN and FR at launch). */
export const LOCALES = ['en', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];

/** Used when no preferred locale is supported (E-1.5 D-19: anything else = EN). */
export const DEFAULT_LOCALE: Locale = 'en';

export type TextDirection = 'ltr' | 'rtl';

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * Picks the first supported locale from BCP 47 tags in preference order (e.g. the device list from
 * expo-localization). Matching is on the primary language subtag, case-insensitive: `fr-CA` → `fr`.
 */
export function resolveLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const language = (tag.split(/[-_]/)[0] ?? '').toLowerCase();
    if (isLocale(language)) return language;
  }
  return DEFAULT_LOCALE;
}

/** Layout direction of a locale. Both launch locales are LTR; the API exists so layouts are RTL-ready. */
export function textDirection(locale: Locale): TextDirection {
  switch (locale) {
    case 'en':
    case 'fr':
      return 'ltr';
  }
}
