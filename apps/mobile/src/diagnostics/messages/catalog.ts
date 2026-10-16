/**
 * Feature-local EN/FR catalog of the Diagnostics screen (DG1 note DS-8, §8): the shared catalog ships in
 * production, so these strings live here and leave with the module. Same key pattern, ICU subset and FR typography
 * as `@codelex/i18n` (checked with `checkCatalogs` in a test), formatted in the locale of `I18nProvider`.
 */
import {
  formatMessage,
  parseMessage,
  type Catalog,
  type Locale,
  type MessageParams,
} from '@codelex/i18n';

import en from './en.json';
import fr from './fr.json';

export type DiagnosticsKey = keyof typeof en;

export const DIAGNOSTICS_CATALOGS: Readonly<Record<Locale, Catalog>> = { en, fr };

/** `t` for diagnostics keys; never throws (a broken message renders its key, as the shared translator does). */
export function diagnosticsTranslator(
  locale: Locale,
): (key: DiagnosticsKey, params?: MessageParams) => string {
  return (key, params = {}) => {
    const source = DIAGNOSTICS_CATALOGS[locale][key] ?? en[key];
    const parsed = parseMessage(source);
    if (!parsed.ok) return key;
    const formatted = formatMessage(parsed.value, locale, params);
    return formatted.ok ? formatted.value : key;
  };
}
