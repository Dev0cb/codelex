/**
 * Public API of `@codelex/design-system`: design tokens (placeholder values until the E-1.4 v1 spec lands) and
 * contrast checks, board/motion/layout tokens (S1). The board renderer lives in `apps/mobile` (E-1.4 A-4 reversal).
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
  BOARD_COLOR_ROLES,
  BOARD_CONTRAST_PAIRS,
  boardContrastFailures,
  mixHex,
  type BoardColorRole,
  type BoardContrastFailure,
  type BoardContrastPair,
  type BoardPalette,
  type LayoutTokens,
  type MotionTokens,
  type OverlayTokens,
  type RadiusTokens,
} from './board-tokens.js';
export {
  boardTokenFiles,
  serializeTokenFile,
  type BoardTokenFiles,
  type SchemeTokenDocument,
  type SharedTokenDocument,
  type Token,
  type TokenType,
} from './tokens-json.js';
export {
  CATEGORY_CONTRAST_BACKGROUNDS,
  CATEGORY_ICONS,
  CATEGORY_IDS,
  CATEGORY_PALETTES,
  categoryContrastFailures,
  type CategoryContrastFailure,
  type CategoryPalette,
  type CategoryTokenId,
} from './category-tokens.js';
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
