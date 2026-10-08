/**
 * Category tokens (E-1.4 §1.2 `color.category.*`; values E-1.5 design §7.1), first used by the Knowledge Card (E-1.5
 * slice S5). The hue is never the only cue: every category badge or chip shows the registry icon and the category
 * name too (E-1.5 §7.1, §9.4), so the nine hues are not claimed to be pairwise distinguishable.
 *
 * Light values are assumption A-2 ("darkened 25 %"): each dark hue mixed with black at 75 %; where that misses 3:1 on
 * a light surface (networking, cloud, data), the next 5 % step that passes (the contrast tests decide).
 */
import { MIN_UI_CONTRAST, contrastRatio } from './contrast.js';
import type { ColorPalette, ColorRole, ColorScheme, HexColor } from './tokens.js';

/** Ids of `packages/lexicon/data/categories.json`, in registry order. */
export const CATEGORY_IDS = [
  'programming',
  'systems',
  'networking',
  'cloud',
  'devops',
  'data',
  'ai',
  'cybersecurity',
  'hardware',
] as const;
export type CategoryTokenId = (typeof CATEGORY_IDS)[number];
export type CategoryPalette = Readonly<Record<CategoryTokenId, HexColor>>;

/** Registry icon names (`categories.json` `icon`), drawn by the E-1.4 §4 `Icon` set. */
export const CATEGORY_ICONS: Readonly<Record<CategoryTokenId, string>> = {
  programming: 'code',
  systems: 'cpu-chip',
  networking: 'network',
  cloud: 'cloud',
  devops: 'infinity',
  data: 'database',
  ai: 'sparkles',
  cybersecurity: 'shield',
  hardware: 'memory',
};

export const CATEGORY_PALETTES: Readonly<Record<ColorScheme, CategoryPalette>> = {
  dark: {
    programming: '#6EA8FE',
    systems: '#B79CFF',
    networking: '#2DD4BF',
    cloud: '#9FD0F5',
    devops: '#F2A65A',
    data: '#7BD88F',
    ai: '#F277C6',
    cybersecurity: '#F25F5C',
    hardware: '#C2B280',
  },
  light: {
    programming: '#537EBF',
    systems: '#8975BF',
    networking: '#1F9486',
    cloud: '#67879F',
    devops: '#B67D44',
    data: '#569764',
    ai: '#B65995',
    cybersecurity: '#B64745',
    hardware: '#928660',
  },
};

/** Surfaces a category badge or chip is drawn on (sheets and raised chips). */
export const CATEGORY_CONTRAST_BACKGROUNDS = [
  'bgSurface',
  'bgRaised',
] as const satisfies readonly ColorRole[];

export interface CategoryContrastFailure {
  readonly category: CategoryTokenId;
  readonly background: (typeof CATEGORY_CONTRAST_BACKGROUNDS)[number];
  readonly scheme: ColorScheme;
  readonly ratio: number;
  readonly min: number;
}

/**
 * Every category hue below 3:1 (WCAG 1.4.11, a UI shape: icon and badge outline) on a badge surface. Category names
 * are text in `textPrimary`, never in the hue.
 */
export function categoryContrastFailures(tokens: {
  readonly scheme: ColorScheme;
  readonly color: ColorPalette;
  readonly category: CategoryPalette;
}): CategoryContrastFailure[] {
  return CATEGORY_IDS.flatMap((category) =>
    CATEGORY_CONTRAST_BACKGROUNDS.flatMap((background) => {
      const ratio = contrastRatio(tokens.category[category], tokens.color[background]);
      return ratio < MIN_UI_CONTRAST
        ? [{ category, background, scheme: tokens.scheme, ratio, min: MIN_UI_CONTRAST }]
        : [];
    }),
  );
}
