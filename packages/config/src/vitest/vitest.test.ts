import { describe, expect, it } from 'vitest';
import { basePreset, defineCodelexVitest, strictPreset } from './index.js';

describe('presets', () => {
  it('base preset requires 80 on lines, statements, functions and branches', () => {
    expect(basePreset.test.coverage.thresholds).toEqual({
      lines: 80,
      statements: 80,
      functions: 80,
      branches: 80,
    });
  });

  it('strict preset requires 90 on lines, statements, functions and branches', () => {
    expect(strictPreset.test.coverage.thresholds).toEqual({
      lines: 90,
      statements: 90,
      functions: 90,
      branches: 90,
    });
  });

  it('uses v8 coverage with text-summary and lcov reporters', () => {
    expect(strictPreset.test.coverage.provider).toBe('v8');
    expect(strictPreset.test.coverage.reporter).toEqual(['text-summary', 'lcov']);
  });
});

describe('defineCodelexVitest', () => {
  it('returns the preset thresholds when there are no overrides', () => {
    const cfg = defineCodelexVitest(basePreset);
    expect(cfg.test?.coverage?.thresholds).toEqual(basePreset.test.coverage.thresholds);
  });

  it('accepts overrides that raise thresholds and keeps the others', () => {
    const cfg = defineCodelexVitest(basePreset, {
      test: { coverage: { thresholds: { branches: 95 } } },
    });
    expect(cfg.test?.coverage?.thresholds).toEqual({
      lines: 80,
      statements: 80,
      functions: 80,
      branches: 95,
    });
  });

  it('accepts overrides equal to the preset', () => {
    expect(() =>
      defineCodelexVitest(strictPreset, {
        test: { coverage: { thresholds: { lines: 90 } } },
      }),
    ).not.toThrow();
  });

  it.each(['lines', 'statements', 'functions', 'branches'] as const)(
    'rejects a lower %s threshold',
    (metric) => {
      expect(() =>
        defineCodelexVitest(strictPreset, {
          test: { coverage: { thresholds: { [metric]: 89 } } },
        }),
      ).toThrow(new RegExp(`${metric}.*89.*90`));
    },
  );

  it('rejects non-numeric or out-of-range thresholds', () => {
    expect(() =>
      defineCodelexVitest(basePreset, {
        test: { coverage: { thresholds: { lines: 101 } } },
      }),
    ).toThrow(/lines/);
    expect(() =>
      defineCodelexVitest(basePreset, {
        test: { coverage: { thresholds: { lines: Number.NaN } } },
      }),
    ).toThrow(/lines/);
  });

  it('rejects a thresholds override that is not an object', () => {
    expect(() =>
      defineCodelexVitest(basePreset, { test: { coverage: { thresholds: 50 as never } } }),
    ).toThrow(/must be an object/);
  });

  it('merges other overrides without touching coverage defaults', () => {
    const cfg = defineCodelexVitest(basePreset, {
      test: { include: ['x/**/*.test.ts'] },
    });
    expect(cfg.test?.include).toEqual(['x/**/*.test.ts']);
    expect(cfg.test?.coverage?.provider).toBe('v8');
  });

  it('does not mutate the preset', () => {
    defineCodelexVitest(basePreset, {
      test: { coverage: { thresholds: { lines: 99 } } },
    });
    expect(basePreset.test.coverage.thresholds.lines).toBe(80);
  });
});
