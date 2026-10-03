/**
 * Public API of `@codelex/i18n`: EN/FR ICU MessageFormat catalogs and a typed `t(key, params)`.
 * Contract: docs/architecture/notes/mobile-app-foundation.md §4.
 */
export { CATALOGS, KEY_PATTERN, checkCatalogs, type Catalog, type MessageKey } from './catalog.js';
export { i18nError, type I18nError, type I18nErrorCode } from './errors.js';
export {
  DEFAULT_LOCALE,
  LOCALES,
  isLocale,
  resolveLocale,
  textDirection,
  type Locale,
  type TextDirection,
} from './locale.js';
export {
  argumentNames,
  formatMessage,
  formatNumber,
  parseMessage,
  type Message,
  type MessageParams,
  type MessagePart,
  type ParamValue,
} from './message.js';
export { PLURAL_CATEGORIES, pluralCategory, type PluralCategory } from './plural.js';
export { createTranslator, type Translator, type TranslatorOptions } from './translator.js';
