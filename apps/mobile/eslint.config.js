import { codelex } from '@codelex/config/eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';

const APP_SOURCE = ['src/**/*.{ts,tsx}'];
const APP_TESTS = ['src/**/*.test.{ts,tsx}'];

// Shared CODELEX rules, plus React rules and the E-1.4 §5 bans for app code (stricter, never looser).
export default defineConfig(
  { ignores: ['.expo/**', 'dist/**', 'coverage/**'] },
  codelex({ tsconfigRootDir: import.meta.dirname }),
  {
    // react-native ships Flow sources; import-x must not parse them (types come from its .d.ts files).
    settings: { 'import-x/ignore': ['node_modules/react-native/'] },
  },
  {
    files: APP_SOURCE,
    extends: [reactHooks.configs.flat['recommended-latest']],
  },
  {
    // E-1.4 §5.1 "no-literal-ui-strings": user-facing text comes from @codelex/i18n; colours from the tokens.
    files: APP_SOURCE,
    ignores: APP_TESTS,
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXText[value=/\\S/]',
          message: 'No hard-coded UI text: use t(key) from @codelex/i18n (E-1.4 §5.1).',
        },
        {
          selector:
            'JSXAttribute[name.name=/^(accessibilityLabel|accessibilityHint|aria-label|title|placeholder|label)$/] > Literal',
          message: 'No hard-coded UI text: use t(key) from @codelex/i18n (E-1.4 §5.1).',
        },
        {
          selector: 'Literal[value=/^(#[0-9a-fA-F]{3,8}|rgba?\\(|hsla?\\()/]',
          message: 'No literal colours: read them from useTokens() (E-1.4 §1.1).',
        },
      ],
    },
  },
  {
    // Expo Router route files: the framework requires a default export (ENGINEERING §1 exception).
    files: ['src/app/**/*.tsx'],
    rules: { 'import-x/no-default-export': 'off' },
  },
);
