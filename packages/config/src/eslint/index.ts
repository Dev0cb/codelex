import { existsSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import boundaries from 'eslint-plugin-boundaries';
import prettierConfig from 'eslint-config-prettier';
import { importX } from 'eslint-plugin-import-x';
import { defineConfig } from 'eslint/config';
import type { ESLint, Linter } from 'eslint';
import tseslint from 'typescript-eslint';

export interface CodelexEslintOptions {
  /** Directory holding the package tsconfig.json (pass `import.meta.dirname`). */
  readonly tsconfigRootDir: string;
  /**
   * Repository root, used to classify files as apps/services/packages. Defaults to the nearest
   * ancestor of `tsconfigRootDir` containing `pnpm-workspace.yaml`.
   */
  readonly repoRoot?: string;
}

export function findRepoRoot(from: string): string {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`pnpm-workspace.yaml not found above ${from}; pass { repoRoot } explicitly`);
    }
    dir = parent;
  }
}

const TS_FILES = ['**/*.{ts,tsx,mts,cts}'];
const JS_FILES = ['**/*.{js,mjs,cjs}'];
const TEST_FILES = ['**/*.test.{ts,tsx}', '**/test/**/*.{ts,tsx}'];
const TOOLING_FILES = ['**/*.config.{js,mjs,cjs,ts,mts}'];
const DETERMINISTIC_FILES = ['packages/game-engine/**', 'packages/bots/**'];
const PURE_FILES = ['packages/game-engine/**'];

/** Generic TypeScript package rules: typescript-eslint strictTypeChecked + import hygiene. */
export function genericPreset(options: CodelexEslintOptions): Linter.Config[] {
  return defineConfig(
    {
      ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/.tmp-*/**'],
    },
    {
      files: TS_FILES,
      extends: [tseslint.configs.strictTypeChecked],
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir: options.tsconfigRootDir,
        },
      },
      plugins: { 'import-x': importX },
      rules: {
        '@typescript-eslint/switch-exhaustiveness-check': 'error',
        '@typescript-eslint/consistent-type-imports': 'error',
        'import-x/no-cycle': 'error',
        'import-x/no-default-export': 'error',
      },
    },
    {
      // Plain JS (config files): no type information available.
      files: JS_FILES,
      extends: [tseslint.configs.disableTypeChecked],
    },
    {
      // Tooling (eslint/prettier/vitest/next configs) requires default exports.
      files: TOOLING_FILES,
      rules: { 'import-x/no-default-export': 'off' },
    },
    {
      // ENGINEERING §1: `!` is only allowed in tests.
      files: TEST_FILES,
      rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
    },
  );
}

/**
 * Architecture boundaries (ENGINEERING §2). Paths are relative to the repository root (ESLint cwd):
 * apps -> packages; services -> packages and themselves; game-engine -> lexicon, config; packages -> packages.
 * Nothing imports apps; services never import other services.
 */
export function boundariesPreset(options: CodelexEslintOptions): Linter.Config[] {
  return defineConfig({
    files: [...TS_FILES, ...JS_FILES],
    plugins: { boundaries: boundaries as unknown as ESLint.Plugin },
    settings: {
      'boundaries/root-path': options.repoRoot ?? findRepoRoot(options.tsconfigRootDir),
      'import/resolver': {
        typescript: { alwaysTryTypes: true },
        node: true,
      },
      'boundaries/elements': [
        {
          type: 'game-engine',
          pattern: 'packages/game-engine',
        },
        {
          type: 'package',
          pattern: 'packages/*',
          capture: ['name'],
        },
        {
          type: 'service',
          pattern: 'services/*',
          capture: ['name'],
        },
        { type: 'app', pattern: 'apps/*', capture: ['name'] },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            {
              from: { element: { type: 'app' } },
              allow: { to: { element: { type: 'package' } } },
            },
            {
              from: { element: { type: 'app' } },
              allow: {
                to: {
                  element: {
                    type: 'app',
                    captured: { name: '{{ from.captured.name }}' },
                  },
                },
              },
            },
            {
              from: { element: { type: 'service' } },
              allow: { to: { element: { type: ['package', 'game-engine'] } } },
            },
            {
              from: { element: { type: 'service' } },
              allow: {
                to: {
                  element: {
                    type: 'service',
                    captured: { name: '{{ from.captured.name }}' },
                  },
                },
              },
            },
            {
              from: { element: { type: 'game-engine' } },
              allow: { to: { element: { type: 'game-engine' } } },
            },
            {
              from: { element: { type: 'game-engine' } },
              allow: {
                to: {
                  element: {
                    type: 'package',
                    captured: { name: ['lexicon', 'config'] },
                  },
                },
              },
            },
            {
              from: { element: { type: 'package' } },
              allow: { to: { element: { type: ['package', 'game-engine'] } } },
            },
          ],
        },
      ],
    },
  });
}

const BANNED_IO_MODULES = [
  ...builtinModules.filter((m) => !m.startsWith('_')),
  ...builtinModules.filter((m) => !m.startsWith('_')).map((m) => `node:${m}`),
];

/** Determinism bans (ENGINEERING §3) for game-engine and bots; IO import bans for game-engine only. */
export function gameEnginePreset(): Linter.Config[] {
  return defineConfig(
    {
      files: DETERMINISTIC_FILES,
      rules: {
        'no-restricted-properties': [
          'error',
          {
            object: 'Date',
            property: 'now',
            message: 'Non-deterministic: inject a Clock (ENGINEERING §3).',
          },
          {
            object: 'Math',
            property: 'random',
            message: 'Non-deterministic: use the injected seeded Rng (ENGINEERING §3).',
          },
          {
            object: 'crypto',
            property: 'randomUUID',
            message: 'Non-deterministic: derive ids from the seeded Rng (ENGINEERING §3).',
          },
          {
            object: 'crypto',
            property: 'getRandomValues',
            message: 'Non-deterministic: use the injected seeded Rng (ENGINEERING §3).',
          },
          {
            object: 'performance',
            property: 'now',
            message: 'Non-deterministic: inject a Clock (ENGINEERING §3).',
          },
        ],
        'no-restricted-syntax': [
          'error',
          {
            selector: "NewExpression[callee.name='Date'][arguments.length=0]",
            message: 'new Date() reads the wall clock: inject a Clock (ENGINEERING §3).',
          },
          {
            selector: "CallExpression[callee.name='Date']",
            message: 'Date() reads the wall clock: inject a Clock (ENGINEERING §3).',
          },
        ],
      },
    },
    {
      files: PURE_FILES,
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: BANNED_IO_MODULES.map((name) => ({
              name,
              message: 'game-engine must be pure: no Node built-ins or IO (ENGINEERING §2).',
            })),
            patterns: [
              {
                group: ['pg', 'redis', 'ioredis', 'kafkajs', 'fastify', 'axios', 'undici', 'ws'],
                message: 'game-engine must be pure: no IO or framework libraries (ENGINEERING §2).',
              },
              {
                group: [
                  'react',
                  'react-*',
                  'react/*',
                  'next',
                  'next/*',
                  'expo',
                  'expo-*',
                  'react-native',
                ],
                message: 'game-engine must not depend on UI frameworks (ENGINEERING §2).',
              },
            ],
          },
        ],
      },
    },
  );
}

/** Full CODELEX flat config. `prettier` is last so formatting rules never conflict. */
export function codelex(options: CodelexEslintOptions): Linter.Config[] {
  return defineConfig(
    genericPreset(options),
    boundariesPreset(options),
    gameEnginePreset(),
    prettierConfig,
  );
}
