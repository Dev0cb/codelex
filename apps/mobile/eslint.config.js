import { codelex } from '@codelex/config/eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';

const APP_SOURCE = ['src/**/*.{ts,tsx}'];
const APP_TESTS = ['src/**/*.test.{ts,tsx}'];
const DIAGNOSTICS = ['src/diagnostics/**/*.{ts,tsx}'];
/** The one production file allowed to reach the preview-only Diagnostics module (diagnostics note §3.2). */
const DIAGNOSTICS_GATE = ['src/features/settings/settings-screen.tsx'];

// E-1.4 §5.1 "no-literal-ui-strings" and colour bans. Flat config replaces a rule's options instead of merging them
// (security review SC-2), so every block below that sets `no-restricted-syntax` restates these selectors.
const UI_SELECTORS = [
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
];

// ADR-0014 §D4 draft-rules ban of @codelex/config (draftRulesPreset), restated for the same reason (SC-2).
const DRAFT_MESSAGE =
  'Draft rules versions are for the simulator and engine tests only (ADR-0014 §D4): apps and services pin a frozen engineRulesVersion.';
const DRAFT_PATHS = [{ name: '@codelex/game-engine/draft', message: DRAFT_MESSAGE }];
const DRAFT_PATTERNS = [
  {
    group: ['@codelex/game-engine/draft/*', '@codelex/game-engine/dist/*'],
    message: DRAFT_MESSAGE,
  },
];

const DIAGNOSTICS_ONLY =
  'Preview-only Diagnostics code is reached only through the build-time gate in settings-screen.tsx (DG1, diagnostics note §3.2).';
const DIAGNOSTICS_IMPORT_PATTERNS = [
  { group: ['**/diagnostics', '**/diagnostics/**'], message: DIAGNOSTICS_ONLY },
  { group: ['@codelex/golden-runner', '@codelex/golden-runner/*'], message: DIAGNOSTICS_ONLY },
];
// `no-restricted-imports` does not see `import()` or `require()`.
const DIAGNOSTICS_DYNAMIC = [
  {
    selector:
      'ImportExpression > Literal[value=/(^|\\/)diagnostics(\\/|$)|@codelex\\/golden-runner/]',
    message: DIAGNOSTICS_ONLY,
  },
  {
    selector:
      'CallExpression[callee.name="require"] > Literal[value=/(^|\\/)diagnostics(\\/|$)|@codelex\\/golden-runner/]',
    message: DIAGNOSTICS_ONLY,
  },
];
// Device fields have one source, inside the Diagnostics module (diagnostics note §3.2, §7).
const PLATFORM_CONSTANTS = {
  selector: 'MemberExpression[object.name="Platform"][property.name="constants"]',
  message:
    'Platform.constants is read only by src/diagnostics/device-info.ts (diagnostics note §7).',
};

// Shared CODELEX rules, plus React rules and the E-1.4 §5 bans for app code (stricter, never looser).
export default defineConfig(
  { ignores: ['.expo/**', 'dist/**', 'dist-diagnostics/**', 'coverage/**'] },
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
    ignores: [...APP_TESTS, ...DIAGNOSTICS, ...DIAGNOSTICS_GATE],
    rules: {
      // Threat model TM-04 / I-7: release builds never print state, seeds or logs (logcat is readable over USB).
      'no-console': 'error',
      'no-restricted-syntax': [
        'error',
        ...UI_SELECTORS,
        ...DIAGNOSTICS_DYNAMIC,
        PLATFORM_CONSTANTS,
      ],
      'no-restricted-imports': [
        'error',
        { paths: DRAFT_PATHS, patterns: [...DRAFT_PATTERNS, ...DIAGNOSTICS_IMPORT_PATTERNS] },
      ],
    },
  },
  {
    // The gate: may import the Diagnostics entry (only behind the folded constant, reviewed by security-engineer).
    files: DIAGNOSTICS_GATE,
    rules: {
      'no-console': 'error',
      'no-restricted-syntax': ['error', ...UI_SELECTORS, PLATFORM_CONSTANTS],
      'no-restricted-imports': ['error', { paths: DRAFT_PATHS, patterns: DRAFT_PATTERNS }],
    },
  },
  {
    // The Diagnostics module (DS-7, security review check 6): no network, no analytics, no match session, no access
    // to the data directory; no zod at runtime (the A2 schema module is imported for types only).
    files: DIAGNOSTICS,
    ignores: APP_TESTS,
    rules: {
      'no-console': 'error',
      'no-restricted-syntax': ['error', ...UI_SELECTORS],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'No network in Diagnostics (DS-7).' },
        { name: 'XMLHttpRequest', message: 'No network in Diagnostics (DS-7).' },
        { name: 'WebSocket', message: 'No network in Diagnostics (DS-7).' },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: DRAFT_PATHS,
          patterns: [
            ...DRAFT_PATTERNS,
            { group: ['**/analytics/**'], message: 'No analytics in Diagnostics (DS-7).' },
            {
              group: ['**/match/match-session', '**/match/match-session.tsx'],
              message: 'Diagnostics never touches the live match (DS-6).',
            },
            {
              group: ['**/persistence/device-fs', '**/persistence/device-fs.ts'],
              message: 'Diagnostics writes only to its cache scratch store (DS-6).',
            },
            { group: ['zod'], message: 'No zod at runtime (S6a bundle rule).' },
          ],
        },
      ],
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@codelex/golden-runner',
              allowTypeImports: true,
              message:
                'Only types from the zod-based entry; runtime code imports @codelex/golden-runner/core (ADR-0016 §D3).',
            },
          ],
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
