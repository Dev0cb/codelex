import { describe, expect, it } from 'vitest';

import {
  BOARD_COLOR_ROLES,
  BOARD_CONTRAST_PAIRS,
  boardContrastFailures,
  mixHex,
  type BoardPalette,
} from './board-tokens.js';
import { contrastRatio, isHexColor } from './contrast.js';
import { COLOR_SCHEMES, getTokens } from './tokens.js';

describe('board tokens (E-1.4 §1.2, §1.5, §1.6)', () => {
  it.each(COLOR_SCHEMES)('define every board colour role as #RRGGBB in %s', (scheme) => {
    const { board } = getTokens(scheme);
    expect(Object.keys(board).sort()).toEqual([...BOARD_COLOR_ROLES].sort());
    for (const role of BOARD_COLOR_ROLES) expect(isHexColor(board[role])).toBe(true);
  });

  it('use the spec values for the dark (brand reference) board', () => {
    const { board } = getTokens('dark');
    expect(board).toMatchObject({
      bg: '#0F151D',
      grid: '#1E2937',
      lastMove: '#FFFFFF',
      tileFace: '#F1E9D2',
      tileInk: '#121821',
      tileValue: '#4A4F57',
      tileBlankOutline: '#8C8570',
      premiumDl: '#56B4E9',
      premiumTl: '#3D7DD9',
      premiumDw: '#E69F00',
      premiumTw: '#E8590C',
      premiumLabel: '#E6EDF3',
    });
  });

  it('keep the same ivory tile in both schemes (a tile is a physical object)', () => {
    const dark = getTokens('dark').board;
    const light = getTokens('light').board;
    expect([light.tileFace, light.tileInk, light.tileValue]).toEqual([
      dark.tileFace,
      dark.tileInk,
      dark.tileValue,
    ]);
  });

  it('derive each premium tint as the premium colour at 22 % over the board background', () => {
    for (const scheme of COLOR_SCHEMES) {
      const { board } = getTokens(scheme);
      expect(board.premiumDlTint).toBe(mixHex(board.premiumDl, board.bg, 0.22));
      expect(board.premiumTlTint).toBe(mixHex(board.premiumTl, board.bg, 0.22));
      expect(board.premiumDwTint).toBe(mixHex(board.premiumDw, board.bg, 0.22));
      expect(board.premiumTwTint).toBe(mixHex(board.premiumTw, board.bg, 0.22));
    }
  });

  it('mix two colours channel by channel, rounding to the nearest integer', () => {
    expect(mixHex('#FFFFFF', '#000000', 0.5)).toBe('#808080');
    expect(mixHex('#FF0000', '#0000FF', 0)).toBe('#0000FF');
    expect(mixHex('#FF0000', '#0000FF', 1)).toBe('#FF0000');
    expect(() => mixHex('#FF0000', '#0000FF', 1.5)).toThrow(/alpha/);
    expect(() => mixHex('red' as `#${string}`, '#0000FF', 0.5)).toThrow(/#RRGGBB/);
  });

  it.each(COLOR_SCHEMES)('meet the board contrast pairs in %s', (scheme) => {
    expect(boardContrastFailures(getTokens(scheme))).toEqual([]);
  });

  it('check tile ink and value, premium labels on every tint and the last-move ring', () => {
    const pairs = BOARD_CONTRAST_PAIRS.map((p) => `${p.foreground}/${p.background}`);
    expect(pairs).toEqual(
      expect.arrayContaining([
        'tileInk/tileFace',
        'tileValue/tileFace',
        'premiumLabel/premiumDlTint',
        'premiumLabel/premiumTlTint',
        'premiumLabel/premiumDwTint',
        'premiumLabel/premiumTwTint',
        'lastMove/bg',
      ]),
    );
  });

  it('report a board contrast failure with its scheme and ratio', () => {
    const tokens = getTokens('dark');
    const board: BoardPalette = { ...tokens.board, tileValue: '#E0D8C0' };
    const failures = boardContrastFailures({ ...tokens, board });
    expect(failures.map((f) => [f.foreground, f.background, f.scheme])).toEqual([
      ['tileValue', 'tileFace', 'dark'],
    ]);
    expect(failures[0]?.ratio).toBeCloseTo(contrastRatio('#E0D8C0', '#F1E9D2'), 5);
  });

  it('define the motion durations, the tile spring and the reduced crossfade', () => {
    const { motion } = getTokens('dark');
    expect(motion.duration).toEqual({
      instant: 0,
      fast: 120,
      base: 200,
      camera: 240,
      slow: 320,
      scoreCount: 400,
      scorePop: 600,
      confirm: 1500,
    });
    expect(motion.springTile).toEqual({ damping: 18, stiffness: 220, mass: 1 });
    expect(motion.reducedCrossfade).toBe(150);
  });

  it('define the layout, radius and overlay tokens', () => {
    const { layout, radius, overlay } = getTokens('light');
    expect(layout).toEqual({
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
    });
    expect(radius).toEqual({ tile: 6, square: 3, button: 14, card: 16, sheet: 20, chip: 999 });
    expect(overlay).toEqual({ scrim: '#101820', scrimOpacity: 0.4 });
    expect(getTokens('dark').overlay).toEqual({ scrim: '#000000', scrimOpacity: 0.6 });
  });

  it('keep Focus squares at least the touch minimum (E-1.4 §1.3)', () => {
    const { layout } = getTokens('dark');
    expect((layout.boardOverview / 15) * layout.focusZoom).toBeGreaterThanOrEqual(layout.touchMin);
  });
});
