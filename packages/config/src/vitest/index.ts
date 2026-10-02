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

function assertNotLowered(preset_: CodelexVitestPreset, overrides: ViteUserConfig): void {
  const thresholds: unknown = overrides.test?.coverage?.thresholds;
  if (thresholds === undefined) return;
  if (typeof thresholds !== 'object' || thresholds === null) {
    throw new Error('coverage.thresholds override must be an object');
  }
  const requested = thresholds as Readonly<Record<string, unknown>>;
  for (const metric of COVERAGE_METRICS) {
    if (!(metric in requested)) continue;
    const value = requested[metric];
    const floor = preset_.test.coverage.thresholds[metric];
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
 * as with Vite's mergeConfig) and may only raise coverage thresholds; lowering throws.
 */
export function defineCodelexVitest(
  presetConfig: CodelexVitestPreset,
  overrides: ViteUserConfig = {},
): ViteUserConfig {
  assertNotLowered(presetConfig, overrides);
  const base: ViteUserConfig = structuredClone(presetConfig) as ViteUserConfig;
  return mergeConfig(base, overrides);
}
