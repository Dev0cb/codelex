import { CATALOGS, type Catalog, type MessageKey } from './catalog.js';
import { i18nError, type I18nError } from './errors.js';
import { DEFAULT_LOCALE, textDirection, type Locale, type TextDirection } from './locale.js';
import { formatMessage, parseMessage, type Message, type MessageParams } from './message.js';

export interface TranslatorOptions {
  /**
   * Called for every formatting problem (missing key or parameter, bad parameter type, syntax). Wire it to the
   * app's diagnostics; the error never contains parameter values.
   */
  readonly onError?: (error: I18nError) => void;
  /** Catalogs to use (tests only); defaults to the shipped EN/FR catalogs. */
  readonly catalogs?: Readonly<Record<Locale, Catalog>>;
}

export interface Translator {
  readonly locale: Locale;
  readonly direction: TextDirection;
  /**
   * Formats `key` with ICU `params`. Never throws: a key missing in the locale falls back to English; any other
   * failure returns the key itself (visible in QA, never a crash) and reports through `onError`. A plain function
   * (no `this`), so `const { t } = translator` is safe.
   */
  readonly t: (key: MessageKey, params?: MessageParams) => string;
}

const NO_PARAMS: MessageParams = {};

export function createTranslator(locale: Locale, options: TranslatorOptions = {}): Translator {
  const catalogs = options.catalogs ?? CATALOGS;
  const report = options.onError ?? ((): void => undefined);
  const cache = new Map<string, Message | null>();

  const parsed = (from: Locale, key: string): Message | undefined => {
    const id = `${from}\u0000${key}`;
    const hit = cache.get(id);
    if (hit !== undefined) return hit ?? undefined;
    const source = catalogs[from][key];
    if (source === undefined) return undefined;
    const result = parseMessage(source);
    if (!result.ok) {
      cache.set(id, null);
      report({ ...result.error, details: { ...result.error.details, locale: from, key } });
      return undefined;
    }
    cache.set(id, result.value);
    return result.value;
  };

  const t = (key: MessageKey, params: MessageParams = NO_PARAMS): string => {
    let from: Locale = locale;
    let message = parsed(locale, key);
    if (
      message === undefined &&
      !Object.hasOwn(catalogs[locale], key) &&
      locale !== DEFAULT_LOCALE
    ) {
      report(i18nError('MISSING_KEY', 'key missing, falling back to English', { locale, key }));
      from = DEFAULT_LOCALE;
      message = parsed(DEFAULT_LOCALE, key);
    }
    if (message === undefined) {
      if (!Object.hasOwn(catalogs[from], key)) {
        report(i18nError('MISSING_KEY', 'key missing from every catalog', { locale, key }));
      }
      return key;
    }
    const result = formatMessage(message, from, params);
    if (result.ok) return result.value;
    report({ ...result.error, details: { ...result.error.details, locale: from, key } });
    return key;
  };

  return { locale, direction: textDirection(locale), t };
}
