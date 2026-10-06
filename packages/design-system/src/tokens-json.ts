/**
 * The board tokens as Design Tokens Community Group (DTCG) JSON for web consumers (E-1.4 §1.1 `tokens/*.json`).
 * The TypeScript tokens stay the source of truth: `tokens/` is generated from them (`tokens:write`) and a test fails
 * when the two drift. Files: one per colour scheme (board palette, overlay) and one shared (motion, layout, radius).
 */
import {
  BOARD_COLOR_ROLES,
  type BoardColorRole,
  type LayoutTokens,
  type MotionTokens,
  type RadiusTokens,
} from './board-tokens.js';
import { getTokens, type ColorScheme } from './tokens.js';

export type TokenType = 'color' | 'number' | 'duration' | 'dimension';

export interface Token {
  readonly $type: TokenType;
  readonly $value: string | number;
}

export interface SchemeTokenDocument {
  readonly $description: string;
  readonly board: Readonly<Record<BoardColorRole, Token>>;
  readonly overlay: { readonly scrim: Token; readonly scrimOpacity: Token };
}

export interface SharedTokenDocument {
  readonly $description: string;
  readonly motion: {
    readonly duration: Readonly<Record<keyof MotionTokens['duration'], Token>>;
    readonly springTile: Readonly<Record<keyof MotionTokens['springTile'], Token>>;
    readonly reducedCrossfade: Token;
  };
  readonly layout: Readonly<Record<keyof LayoutTokens, Token>>;
  readonly radius: Readonly<Record<keyof RadiusTokens, Token>>;
}

export interface BoardTokenFiles {
  readonly 'board.dark.json': SchemeTokenDocument;
  readonly 'board.light.json': SchemeTokenDocument;
  readonly 'board.shared.json': SharedTokenDocument;
}

const color = (value: string): Token => ({ $type: 'color', $value: value });
const number = (value: number): Token => ({ $type: 'number', $value: value });
const ms = (value: number): Token => ({ $type: 'duration', $value: `${String(value)}ms` });
const dp = (value: number): Token => ({ $type: 'dimension', $value: `${String(value)}px` });

/** Maps every key of `values` through `as`, keeping the source key order. */
function mapValues<K extends string>(
  values: Readonly<Record<K, number>>,
  as: (value: number, key: K) => Token,
): Record<K, Token> {
  const out = {} as Record<K, Token>;
  for (const key of Object.keys(values) as K[]) out[key] = as(values[key], key);
  return out;
}

/** Zoom levels are factors, everything else in `layout` is a length in dp (1 dp = 1 CSS px). */
const LAYOUT_FACTORS: ReadonlySet<keyof LayoutTokens> = new Set([
  'focusZoom',
  'zoomMin',
  'zoomMax',
]);

function schemeDocument(scheme: ColorScheme): SchemeTokenDocument {
  const tokens = getTokens(scheme);
  const board = {} as Record<BoardColorRole, Token>;
  for (const role of BOARD_COLOR_ROLES) board[role] = color(tokens.board[role]);
  return {
    $description: `CODELEX board tokens, ${scheme} scheme. Generated from @codelex/design-system; do not edit.`,
    board,
    overlay: {
      scrim: color(tokens.overlay.scrim),
      scrimOpacity: number(tokens.overlay.scrimOpacity),
    },
  };
}

function sharedDocument(): SharedTokenDocument {
  const { motion, layout, radius } = getTokens('dark');
  return {
    $description:
      'CODELEX board motion, layout and radius tokens (both schemes). Generated from @codelex/design-system; do not edit.',
    motion: {
      duration: mapValues(motion.duration, ms),
      springTile: mapValues(motion.springTile, number),
      reducedCrossfade: ms(motion.reducedCrossfade),
    },
    layout: mapValues(layout, (value, key) =>
      LAYOUT_FACTORS.has(key) ? number(value) : dp(value),
    ),
    radius: mapValues(radius, dp),
  };
}

/** Every file of `tokens/`, by file name. */
export function boardTokenFiles(): BoardTokenFiles {
  return {
    'board.dark.json': schemeDocument('dark'),
    'board.light.json': schemeDocument('light'),
    'board.shared.json': sharedDocument(),
  };
}

/** The exact bytes of a token file: two-space JSON and a final newline (stable under Prettier). */
export function serializeTokenFile(document: unknown): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
