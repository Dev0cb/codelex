export type I18nErrorCode =
  | 'SYNTAX'
  | 'UNSUPPORTED'
  | 'MISSING_KEY'
  | 'MISSING_PARAM'
  | 'BAD_PARAM_TYPE'
  | 'CATALOG_MISMATCH'
  | 'TYPOGRAPHY';

/** Typed i18n error (ENGINEERING §4). `details` never holds parameter values: they may be user data. */
export interface I18nError {
  readonly code: I18nErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, string | number>>;
}

export function i18nError(
  code: I18nErrorCode,
  message: string,
  details?: Readonly<Record<string, string | number>>,
): I18nError {
  return details === undefined ? { code, message } : { code, message, details };
}
