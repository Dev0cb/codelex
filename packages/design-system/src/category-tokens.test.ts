import { describe, expect, it } from 'vitest';

import {
  CATEGORY_CONTRAST_BACKGROUNDS,
  CATEGORY_IDS,
  CATEGORY_ICONS,
  categoryContrastFailures,
  type CategoryPalette,
} from './category-tokens.js';
import { MIN_UI_CONTRAST, isHexColor } from './contrast.js';
import { COLOR_SCHEMES, getTokens } from './tokens.js';

describe('category tokens (E-1.4 §1.2 `color.category.*`, E-1.5 §7.1)', () => {
  it.each(COLOR_SCHEMES)('define one #RRGGBB hue per lexicon category in %s', (scheme) => {
    const { category } = getTokens(scheme);
    expect(Object.keys(category).sort()).toEqual([...CATEGORY_IDS].sort());
    for (const id of CATEGORY_IDS) expect(isHexColor(category[id])).toBe(true);
  });

  it('use the E-1.5 §7.1 values for the dark (brand reference) scheme', () => {
    expect(getTokens('dark').category).toEqual({
      programming: '#6EA8FE',
      systems: '#B79CFF',
      networking: '#2DD4BF',
      cloud: '#9FD0F5',
      devops: '#F2A65A',
      data: '#7BD88F',
      ai: '#F277C6',
      cybersecurity: '#F25F5C',
      hardware: '#C2B280',
    });
  });

  it('name the registry icon of every category (shape always accompanies the hue)', () => {
    expect(CATEGORY_ICONS).toEqual({
      programming: 'code',
      systems: 'cpu-chip',
      networking: 'network',
      cloud: 'cloud',
      devops: 'infinity',
      data: 'database',
      ai: 'sparkles',
      cybersecurity: 'shield',
      hardware: 'memory',
    });
  });

  it.each(COLOR_SCHEMES)(
    'reach 3:1 (UI shape) on every surface a badge sits on in %s',
    (scheme) => {
      expect(categoryContrastFailures(getTokens(scheme))).toEqual([]);
      expect(CATEGORY_CONTRAST_BACKGROUNDS).toEqual(['bgSurface', 'bgRaised']);
    },
  );

  it('report a hue below 3:1', () => {
    const tokens = getTokens('light');
    const category: CategoryPalette = { ...tokens.category, cloud: '#9FD0F5' };
    const failures = categoryContrastFailures({ ...tokens, category });
    expect(failures.length).toBeGreaterThan(0);
    for (const failure of failures) {
      expect(failure).toMatchObject({ category: 'cloud', scheme: 'light', min: MIN_UI_CONTRAST });
      expect(failure.ratio).toBeLessThan(MIN_UI_CONTRAST);
    }
  });
});
