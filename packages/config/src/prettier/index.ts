import type { Config } from 'prettier';

/** Single Prettier configuration for the whole monorepo (re-exported by each consumer). */
export const prettierConfig: Config = {
  printWidth: 100,
  singleQuote: true,
  trailingComma: 'all',
  semi: true,
  endOfLine: 'lf',
};
