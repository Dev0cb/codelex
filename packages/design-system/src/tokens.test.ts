import { describe, expect, it } from 'vitest';

import { contrastFailures, contrastRatio, isHexColor, relativeLuminance } from './contrast.js';
import {
  COLOR_ROLES,
  COLOR_SCHEMES,
  SPACE_STEPS,
  TOKENS_STATUS,
  TYPE_ROLES,
  getTokens,
  resolveColorScheme,
  type Tokens,
} from './tokens.js';

describe('tokens', () => {
  it('are a partial E-1.4 set (flip to v1 only when every §1 token exists)', () => {
    expect(TOKENS_STATUS).toBe('partial');
  });

  it.each(COLOR_SCHEMES)('define every colour role as #RRGGBB in %s', (scheme) => {
    const { color } = getTokens(scheme);
    expect(Object.keys(color).sort()).toEqual([...COLOR_ROLES].sort());
    for (const role of COLOR_ROLES) expect(isHexColor(color[role])).toBe(true);
  });

  it('define an increasing integer spacing scale starting at 0', () => {
    const { space } = getTokens('dark');
    const values = SPACE_STEPS.map((step) => space[step]);
    expect(values[0]).toBe(0);
    for (let i = 1; i < values.length; i++) {
      expect(Number.isInteger(values[i])).toBe(true);
      expect(values[i]).toBeGreaterThan(values[i - 1]!);
    }
  });

  it('define every type role with a line height at least the font size', () => {
    const { type } = getTokens('light');
    expect(Object.keys(type).sort()).toEqual([...TYPE_ROLES].sort());
    for (const role of TYPE_ROLES) {
      expect(type[role].lineHeight).toBeGreaterThanOrEqual(type[role].fontSize);
    }
  });

  it.each(COLOR_SCHEMES)('meet WCAG AA contrast in %s', (scheme) => {
    expect(contrastFailures(getTokens(scheme))).toEqual([]);
  });

  it('report contrast failures', () => {
    const tokens = getTokens('dark');
    const broken: Tokens = { ...tokens, color: { ...tokens.color, textMuted: '#1C2632' } };
    const failures = contrastFailures(broken);
    expect(failures.map((f) => [f.foreground, f.background])).toEqual([
      ['textMuted', 'bgBase'],
      ['textMuted', 'bgSurface'],
      ['textMuted', 'bgRaised'],
    ]);
    expect(failures[0]?.scheme).toBe('dark');
  });

  it('resolve the OS appearance, dark by default', () => {
    expect(resolveColorScheme('light')).toBe('light');
    expect(resolveColorScheme('dark')).toBe('dark');
    expect(resolveColorScheme(null)).toBe('dark');
    expect(resolveColorScheme(undefined)).toBe('dark');
    expect(resolveColorScheme('unspecified')).toBe('dark');
  });
});

describe('contrast', () => {
  it('computes WCAG ratios', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
    expect(contrastRatio('#767676', '#FFFFFF')).toBeCloseTo(4.54, 2);
    expect(relativeLuminance('#020202')).toBeCloseTo(0.000607, 6);
  });

  it('rejects malformed colours', () => {
    expect(isHexColor('#12345')).toBe(false);
    expect(isHexColor('red')).toBe(false);
    expect(() => relativeLuminance('#GGGGGG')).toThrow(/#RRGGBB/);
  });
});
