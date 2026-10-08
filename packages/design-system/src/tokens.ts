/**
 * Design tokens (sprint A1), a subset of the E-1.4 thin spec `docs/specs/E-1.4-design-system/design-system-v1.md`:
 * the chrome colour roles of §1.2, the type ramp of §1.4 (system font) and `space.0..8` of §1.5, with the spec
 * values. Keys are flat camelCase as in spec §1.1 (`color.bg.base` → `color.bgBase`, `type.body.s` → `type.bodyS`).
 * Board, tile, premium, motion, layout, radius and overlay tokens live in `board-tokens.ts` (slice S1).
 * Category hues live in `category-tokens.ts` (E-1.5 slice S5).
 * TODO: mono type and elevation tokens, and the move to the DTCG JSON files of §1.1 (`tokens/*.json`)
 * generating this same typed shape, so consumers do not change.
 */
import {
  BOARD_PALETTES,
  LAYOUT,
  MOTION,
  OVERLAYS,
  RADIUS,
  type BoardPalette,
  type LayoutTokens,
  type MotionTokens,
  type OverlayTokens,
  type RadiusTokens,
} from './board-tokens.js';
import { CATEGORY_PALETTES, type CategoryPalette } from './category-tokens.js';

/**
 * Lifecycle of the token set. `partial` = spec values for the groups exported here, other groups pending (S1);
 * `v1` = every token of E-1.4 §1.
 */
export type TokensStatus = 'partial' | 'v1';
export const TOKENS_STATUS: TokensStatus = 'partial';

export const COLOR_SCHEMES = ['dark', 'light'] as const;
/** Dark is the default and the brand reference (E-1.4 §1.2); the theme follows the OS. */
export type ColorScheme = (typeof COLOR_SCHEMES)[number];

/** Chrome colour roles of E-1.4 §1.2 (board, tile, premium and category colours arrive with S1). */
export const COLOR_ROLES = [
  'bgBase',
  'bgSurface',
  'bgRaised',
  'borderSubtle',
  'textPrimary',
  'textMuted',
  'accentPrimary',
  'accentOnPrimary',
  'feedbackError',
  'feedbackWarning',
  'feedbackInfo',
] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

/** Opaque sRGB colour, `#RRGGBB` (alpha colours such as `color.scrim` arrive with S1). */
export type HexColor = `#${string}`;
export type ColorPalette = Readonly<Record<ColorRole, HexColor>>;

/** Spacing steps `space.0..8`, in dp. */
export const SPACE_STEPS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
export type SpaceStep = (typeof SPACE_STEPS)[number];
export type SpaceScale = Readonly<Record<SpaceStep, number>>;

/** Text roles of the system font (mono roles for tiles and scores arrive with the board, slice S1). */
export const TYPE_ROLES = [
  'display',
  'title',
  'heading',
  'bodyL',
  'body',
  'bodyS',
  'caption',
] as const;
export type TypeRole = (typeof TYPE_ROLES)[number];
export type FontWeight = '400' | '500' | '600' | '700';

export interface TypeStyle {
  /** Size in sp; scales with the OS font size (dynamic type). */
  readonly fontSize: number;
  /** Line height in dp. */
  readonly lineHeight: number;
  readonly fontWeight: FontWeight;
}
export type TypeScale = Readonly<Record<TypeRole, TypeStyle>>;

export interface Tokens {
  readonly status: TokensStatus;
  readonly scheme: ColorScheme;
  readonly color: ColorPalette;
  readonly space: SpaceScale;
  readonly type: TypeScale;
  readonly board: BoardPalette;
  readonly motion: MotionTokens;
  readonly layout: LayoutTokens;
  readonly radius: RadiusTokens;
  readonly overlay: OverlayTokens;
  /** `color.category.*` (E-1.4 §1.2): one hue per lexicon category, always shown with its icon and name. */
  readonly category: CategoryPalette;
}

// E-1.4 §1.2 (dark = E-1.5 §7.1; light = assumption A-2, the contrast tests decide).
const PALETTES: Readonly<Record<ColorScheme, ColorPalette>> = {
  dark: {
    bgBase: '#0B0F14',
    bgSurface: '#121923',
    bgRaised: '#1A2330',
    borderSubtle: '#2A3646',
    textPrimary: '#E6EDF3',
    textMuted: '#9AA7B4',
    accentPrimary: '#22D3A6',
    accentOnPrimary: '#04130F',
    feedbackError: '#FF7A7A',
    feedbackWarning: '#FFC857',
    feedbackInfo: '#6CB6FF',
  },
  light: {
    bgBase: '#F6F8FA',
    bgSurface: '#FFFFFF',
    bgRaised: '#EAEFF4',
    borderSubtle: '#C9D3DE',
    textPrimary: '#101820',
    textMuted: '#4A5764',
    // Spec #00876A gives 4.49:1 under accentOnPrimary (< 4.5); one green step darker passes (A-2: the contrast
    // script decides). Reported to ux-ui-designer for the spec.
    accentPrimary: '#00866A',
    accentOnPrimary: '#FFFFFF',
    feedbackError: '#B3261E',
    feedbackWarning: '#8A5A00',
    feedbackInfo: '#0B63B8',
  },
};

// E-1.4 §1.5: 4 dp grid; `space.1` = 2 is the only off-grid step (rack gaps).
const SPACE: SpaceScale = { 0: 0, 1: 2, 2: 4, 3: 8, 4: 12, 5: 16, 6: 24, 7: 32, 8: 48 };

// E-1.4 §1.4 (system font; sizes in sp, line heights in dp).
const TYPE: TypeScale = {
  display: { fontSize: 32, lineHeight: 40, fontWeight: '700' },
  title: { fontSize: 24, lineHeight: 32, fontWeight: '700' },
  heading: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
  bodyL: { fontSize: 18, lineHeight: 26, fontWeight: '400' },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
  bodyS: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
};

/** Resolved tokens for a colour scheme. */
export function getTokens(scheme: ColorScheme): Tokens {
  return {
    status: TOKENS_STATUS,
    scheme,
    color: PALETTES[scheme],
    space: SPACE,
    type: TYPE,
    board: BOARD_PALETTES[scheme],
    motion: MOTION,
    layout: LAYOUT,
    radius: RADIUS,
    overlay: OVERLAYS[scheme],
    category: CATEGORY_PALETTES[scheme],
  };
}

/** Maps an OS appearance (`'dark' | 'light' | null | undefined`, e.g. `useColorScheme()`) to a scheme. */
export function resolveColorScheme(os: string | null | undefined): ColorScheme {
  return os === 'light' ? 'light' : 'dark';
}
