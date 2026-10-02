import { mergeConfig, type ViteUserConfig } from 'vitest/config';

export const COVERAGE_METRICS = ['lines', 'statements', 'functions', 'branches'] as const;
export type CoverageMetric = (typeof COVERAGE_METRICS)[number];
export type CoverageThresholds = Readonly<Record<CoverageMetric, number>>;

export interface CodelexVitestPreset {
  readonly test: {
    readonly passWithNoTests: false;
    readonly coverage: {
      readonly provider: 'v8';
      readonly reporter: readonly string[];
      readonly include: readonly string[];
      readonly exclude: readonly string[];
      readonly thresholds: CoverageThresholds;
    };
  };
}

function preset(threshold: number): CodelexVitestPreset {
  return {
    test: {
      passWithNoTests: false,
      coverage: {
        provider: 'v8',
        reporter: ['text-summary', 'lcov'],
        include: ['src/**/*.ts'],
        exclude: ['**/*.test.ts', '**/*.d.ts'],
        thresholds: {
          lines: threshold,
          statements: threshold,
          functions: threshold,
          branches: threshold,
        },
      },
    },
  };
}

/** Default for every package: 80 % on lines, statements, functions and branches (ADR-0010). */
export const basePreset: CodelexVitestPreset = preset(80);

/** Mandatory for packages/game-engine, packages/protocol and packages/config: 90 % on all four. */
export const strictPreset: CodelexVitestPreset = preset(90);

/** Exclude patterns that can only match test support files, never source code. */
const TEST_ONLY_EXCLUDE =
  /^(\*\*\/)?((test|tests|__tests__|__mocks__|__fixtures__|fixtures|e2e)(\/[^.]*)?|\*\.(test|spec|d)\.(\w+|\*))$/;

function assertSafeCoverageOverrides(
  base: CodelexVitestPreset,
  coverage: Readonly<Record<string, unknown>>,
): void {
  if ('include' in coverage) {
    throw new Error('coverage.include may not be overridden: it would shrink the measured surface');
  }
  if ('enabled' in coverage && coverage['enabled'] !== true) {
    throw new Error('coverage.enabled may not be disabled');
  }
  if ('exclude' in coverage) {
    const exclude = coverage['exclude'];
    const ok =
      Array.isArray(exclude) &&
      exclude.every(
        (p: unknown) => typeof p === 'string' && !p.includes('..') && TEST_ONLY_EXCLUDE.test(p),
      );
    if (!ok) {
      throw new Error(
        'coverage.exclude may only list test-only patterns (test/**, **/__mocks__/**, **/*.spec.ts, ...)',
      );
    }
  }
  const thresholds: unknown = coverage['thresholds'];
  if (thresholds === undefined) return;
  if (typeof thresholds !== 'object' || thresholds === null) {
    throw new Error('coverage.thresholds override must be an object');
  }
  const requested = thresholds as Readonly<Record<string, unknown>>;
  for (const key of Object.keys(requested)) {
    if (
      !(COVERAGE_METRICS as readonly string[]).includes(key) &&
      key !== 'perFile' &&
      key !== '100'
    ) {
      throw new Error(
        `coverage.thresholds.${key} is not allowed (only the four metrics, perFile, 100)`,
      );
    }
  }
  if ('perFile' in requested && typeof requested['perFile'] !== 'boolean') {
    throw new Error('coverage.thresholds.perFile must be a boolean');
  }
  if ('100' in requested && requested['100'] !== true) {
    throw new Error('coverage.thresholds.100 may only be true');
  }
  for (const metric of COVERAGE_METRICS) {
    if (!(metric in requested)) continue;
    const value = requested[metric];
    const floor = base.test.coverage.thresholds[metric];
    if (typeof value !== 'number' || !Number.isFinite(value) || value > 100) {
      throw new Error(
        `coverage threshold "${metric}" must be a number <= 100, got ${String(value)}`,
      );
    }
    if (value < floor) {
      throw new Error(
        `coverage threshold "${metric}" may not be lowered: override ${String(value)} < preset ${String(floor)}`,
      );
    }
  }
}

/**
 * Builds a Vitest config from a CODELEX preset. Overrides are deep-merged (arrays concatenate,
 * as with Vite's mergeConfig) and may only raise coverage thresholds; lowering them, disabling coverage or hiding source throws.
 */
export function defineCodelexVitest(
  presetConfig: CodelexVitestPreset,
  overrides: ViteUserConfig = {},
): ViteUserConfig {
  const coverage: unknown = overrides.test?.coverage;
  if (typeof coverage === 'object' && coverage !== null) {
    assertSafeCoverageOverrides(presetConfig, coverage as Readonly<Record<string, unknown>>);
  }
  const base: ViteUserConfig = structuredClone(presetConfig) as ViteUserConfig;
  return mergeConfig(base, overrides);
}
