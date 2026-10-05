/**
 * Board, tile, premium, motion, layout, radius and overlay tokens for slice S1 of E-1.5 (E-1.4 thin spec §1.2,
 * §1.5, §1.6; dark values = E-1.5 design §7.1, light = assumption A-2). Same flat camelCase convention as the
 * chrome roles (`color.premium.dl` → `board.premiumDl`). Category, mono type and elevation tokens are still to
 * come (S2/S5), so `TOKENS_STATUS` stays `partial`.
 */
import { contrastRatio, isHexColor, MIN_TEXT_CONTRAST, MIN_UI_CONTRAST } from './contrast.js';
import type { ColorScheme, HexColor } from './tokens.js';

export const BOARD_COLOR_ROLES = [
  'bg',
  'grid',
  'lastMove',
  'tileFace',
  'tileInk',
  'tileValue',
  'tileBlankOutline',
  'premiumDl',
  'premiumTl',
  'premiumDw',
  'premiumTw',
  'premiumDlTint',
  'premiumTlTint',
  'premiumDwTint',
  'premiumTwTint',
  'premiumLabel',
] as const;
export type BoardColorRole = (typeof BOARD_COLOR_ROLES)[number];
export type BoardPalette = Readonly<Record<BoardColorRole, HexColor>>;

/** E-1.4 §1.6. Durations in ms; `springTile` feeds Reanimated `withSpring`. */
export interface MotionTokens {
  readonly duration: {
    readonly instant: number;
    readonly fast: number;
    readonly base: number;
    readonly camera: number;
    readonly slow: number;
    readonly scoreCount: number;
    readonly scorePop: number;
    /** Confirmations only; information never auto-dismisses. */
    readonly confirm: number;
  };
  readonly springTile: {
    readonly damping: number;
    readonly stiffness: number;
    readonly mass: number;
  };
  /** `motion.reduced.crossfade`: the reduced-motion twin of a slide. */
  readonly reducedCrossfade: number;
}

/** E-1.4 §1.3 and §1.5, in dp (zoom values are factors). */
export interface LayoutTokens {
  readonly marginMatch: number;
  readonly marginScreen: number;
  readonly touchMin: number;
  readonly boardOverview: number;
  readonly tileRackWidth: number;
  readonly tileRackHeight: number;
  readonly rackGap: number;
  readonly focusZoom: number;
  readonly zoomMin: number;
  readonly zoomMax: number;
  readonly contentMaxWidth: number;
}

export interface RadiusTokens {
  readonly tile: number;
  readonly square: number;
  readonly button: number;
  readonly card: number;
  readonly sheet: number;
  readonly chip: number;
}

/** `color.scrim` (E-1.4 §1.2) split into an opaque colour and an opacity, so every colour stays `#RRGGBB`. */
export interface OverlayTokens {
  readonly scrim: HexColor;
  readonly scrimOpacity: number;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** `fg` at `alpha` over an opaque `bg`, per channel, rounded to the nearest integer. */
export function mixHex(fg: HexColor, bg: HexColor, alpha: number): HexColor {
  if (!HEX.test(fg) || !HEX.test(bg)) throw new Error('not a #RRGGBB colour');
  if (!(alpha >= 0 && alpha <= 1)) throw new Error('alpha must be in [0, 1]');
  let out = '#';
  for (const offset of [1, 3, 5]) {
    const f = parseInt(fg.slice(offset, offset + 2), 16);
    const b = parseInt(bg.slice(offset, offset + 2), 16);
    out += Math.round(f * alpha + b * (1 - alpha))
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  }
  if (!isHexColor(out)) throw new Error('mixHex produced a malformed colour');
  return out;
}

/** Premium square fill: the premium colour at 22 % over `board.bg` (E-1.4 §1.2). */
const TINT_ALPHA = 0.22;

type BasePalette = Omit<
  BoardPalette,
  'premiumDlTint' | 'premiumTlTint' | 'premiumDwTint' | 'premiumTwTint'
>;

function withTints(base: BasePalette): BoardPalette {
  return {
    ...base,
    premiumDlTint: mixHex(base.premiumDl, base.bg, TINT_ALPHA),
    premiumTlTint: mixHex(base.premiumTl, base.bg, TINT_ALPHA),
    premiumDwTint: mixHex(base.premiumDw, base.bg, TINT_ALPHA),
    premiumTwTint: mixHex(base.premiumTw, base.bg, TINT_ALPHA),
  };
}

// Tile faces, ink and values are the same in both schemes (E-1.4 §1.2).
const TILE = { tileFace: '#F1E9D2', tileInk: '#121821', tileValue: '#4A4F57' } as const;

export const BOARD_PALETTES: Readonly<Record<ColorScheme, BoardPalette>> = {
  dark: withTints({
    bg: '#0F151D',
    grid: '#1E2937',
    lastMove: '#FFFFFF',
    ...TILE,
    tileBlankOutline: '#8C8570',
    premiumDl: '#56B4E9',
    premiumTl: '#3D7DD9',
    premiumDw: '#E69F00',
    premiumTw: '#E8590C',
    premiumLabel: '#E6EDF3',
  }),
  light: withTints({
    bg: '#DDE4EB',
    grid: '#B8C4D0',
    lastMove: '#101820',
    ...TILE,
    tileBlankOutline: '#6E6753',
    premiumDl: '#1F7FB8',
    premiumTl: '#1F58B5',
    premiumDw: '#A66A00',
    premiumTw: '#C2410C',
    premiumLabel: '#101820',
  }),
};

export const MOTION: MotionTokens = {
  duration: {
    instant: 0,
    fast: 120,
    base: 200,
    camera: 240,
    slow: 320,
    scoreCount: 400,
    scorePop: 600,
    confirm: 1500,
  },
  springTile: { damping: 18, stiffness: 220, mass: 1 },
  reducedCrossfade: 150,
};

export const LAYOUT: LayoutTokens = {
  marginMatch: 8,
  marginScreen: 16,
  touchMin: 48,
  boardOverview: 344,
  tileRackWidth: 48,
  tileRackHeight: 56,
  rackGap: 2,
  focusZoom: 2.15,
  zoomMin: 1,
  zoomMax: 2.5,
  contentMaxWidth: 480,
};

export const RADIUS: RadiusTokens = {
  tile: 6,
  square: 3,
  button: 14,
  card: 16,
  sheet: 20,
  chip: 999,
};

export const OVERLAYS: Readonly<Record<ColorScheme, OverlayTokens>> = {
  dark: { scrim: '#000000', scrimOpacity: 0.6 },
  light: { scrim: '#101820', scrimOpacity: 0.4 },
};

export interface BoardContrastPair {
  readonly foreground: BoardColorRole;
  readonly background: BoardColorRole;
  readonly min: number;
}

/** Board pairs that must stay legible in every scheme (E-1.4 §1.2 and §2.5: labels are mandatory text). */
export const BOARD_CONTRAST_PAIRS: readonly BoardContrastPair[] = [
  { foreground: 'tileInk', background: 'tileFace', min: MIN_TEXT_CONTRAST },
  { foreground: 'tileValue', background: 'tileFace', min: MIN_TEXT_CONTRAST },
  ...(['premiumDlTint', 'premiumTlTint', 'premiumDwTint', 'premiumTwTint'] as const).map(
    (background) => ({ foreground: 'premiumLabel' as const, background, min: MIN_TEXT_CONTRAST }),
  ),
  { foreground: 'lastMove', background: 'bg', min: MIN_UI_CONTRAST },
];

export interface BoardContrastFailure extends BoardContrastPair {
  readonly scheme: ColorScheme;
  readonly ratio: number;
}

/** Every pair of `BOARD_CONTRAST_PAIRS` below its minimum (empty = compliant). */
export function boardContrastFailures(tokens: {
  readonly scheme: ColorScheme;
  readonly board: BoardPalette;
}): BoardContrastFailure[] {
  return BOARD_CONTRAST_PAIRS.flatMap((pair) => {
    const ratio = contrastRatio(tokens.board[pair.foreground], tokens.board[pair.background]);
    return ratio < pair.min ? [{ ...pair, scheme: tokens.scheme, ratio }] : [];
  });
}
