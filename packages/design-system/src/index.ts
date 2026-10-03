/**
 * Public API of `@codelex/design-system`: design tokens (placeholder values until the E-1.4 v1 spec lands) and
 * contrast checks. Components (board renderer, buttons) arrive with slice S1.
 */
export {
  COLOR_ROLES,
  COLOR_SCHEMES,
  SPACE_STEPS,
  TOKENS_STATUS,
  TYPE_ROLES,
  getTokens,
  resolveColorScheme,
  type ColorPalette,
  type ColorRole,
  type ColorScheme,
  type FontWeight,
  type HexColor,
  type SpaceScale,
  type SpaceStep,
  type Tokens,
  type TokensStatus,
  type TypeRole,
  type TypeScale,
  type TypeStyle,
} from './tokens.js';
export {
  CONTRAST_PAIRS,
  MIN_TEXT_CONTRAST,
  MIN_UI_CONTRAST,
  contrastFailures,
  contrastRatio,
  isHexColor,
  relativeLuminance,
  type ContrastFailure,
  type ContrastPair,
} from './contrast.js';
