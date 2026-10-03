import {
  createTranslator,
  resolveLocale,
  type I18nError,
  type Locale,
  type Translator,
} from '@codelex/i18n';
import { useLocales } from 'expo-localization';
import { createContext, useContext, useMemo, type ReactNode } from 'react';

const I18nContext = createContext<Translator | null>(null);

/** Formatting problems are bugs in catalogs or call sites: visible in development, silent in release builds. */
function reportI18nError(error: I18nError): void {
  if (__DEV__) console.warn(`[i18n] ${error.code}: ${error.message}`, error.details);
}

export interface I18nProviderProps {
  readonly children: ReactNode;
  /** Forces a locale (tests, previews). Default: the device locale list (E-1.5 D-19, no in-app override). */
  readonly locale?: Locale;
}

/** Provides the translator for the device locale; re-renders when the OS language list changes. */
export function I18nProvider({ children, locale }: I18nProviderProps): ReactNode {
  const deviceLocales = useLocales();
  const resolved = locale ?? resolveLocale(deviceLocales.map((l) => l.languageTag));
  const translator = useMemo(
    () => createTranslator(resolved, { onError: reportI18nError }),
    [resolved],
  );
  return <I18nContext value={translator}>{children}</I18nContext>;
}

/** The current translator: `const { t } = useI18n()`. */
export function useI18n(): Translator {
  const translator = useContext(I18nContext);
  if (translator === null) throw new Error('useI18n must be used inside <I18nProvider>');
  return translator;
}
