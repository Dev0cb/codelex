/**
 * What the board shows, as plain data (E-1.4 §2.1 `SquareView`): premium kinds from the engine layout, committed
 * tiles from the observation's board, pending tiles from the app. The renderer only draws this; it holds no rules.
 */
import type { BoardPalette, HexColor } from '@codelex/design-system';
import type { Layout, Letter, LetterTable, Seat, Square } from '@codelex/game-engine';
import type { MessageKey, MessageParams } from '@codelex/i18n';

import { BOARD_SIZE } from './geometry';

export type PremiumKind = 'DL' | 'TL' | 'DW' | 'TW';

export interface TileView {
  /** Uppercase; a blank shows its designated letter. */
  readonly letter: Letter;
  readonly value: number;
  readonly isBlank: boolean;
  /** Who played it; null while pending. */
  readonly owner: 'you' | 'opponent' | null;
  readonly pending: boolean;
  readonly lastMove: boolean;
}

export interface SquareView {
  readonly row: number;
  readonly col: number;
  readonly premium: PremiumKind | null;
  readonly start: boolean;
  readonly tile: TileView | null;
}

export interface BoardSquaresInput {
  readonly layout: Layout;
  readonly letters: LetterTable;
  /** Observation board rows: `.` empty, uppercase letter, lowercase = blank as that letter. */
  readonly board: readonly string[];
  readonly pending: readonly {
    readonly row: number;
    readonly col: number;
    readonly tile: string;
  }[];
  readonly owners: Readonly<Record<string, Seat>>;
  readonly lastMove: readonly Square[];
  /** Seat shown as "you". Default 0. */
  readonly humanSeat?: Seat;
}

const CODE_A = 65;

function tileOf(
  char: string,
  letters: LetterTable,
): { letter: Letter; value: number; isBlank: boolean } {
  const upper = char.toUpperCase() as Letter;
  const isBlank = char !== upper;
  return {
    letter: upper,
    value: isBlank ? 0 : (letters.values[upper.charCodeAt(0) - CODE_A] ?? 0),
    isBlank,
  };
}

/** The 225 squares, row-major. */
export function boardSquares(input: BoardSquaresInput): SquareView[] {
  const { layout, letters, board, owners } = input;
  const human = input.humanSeat ?? 0;
  const pending = new Map(input.pending.map((p) => [`${String(p.row)},${String(p.col)}`, p.tile]));
  const last = new Set(input.lastMove.map((s) => `${String(s.row)},${String(s.col)}`));
  const squares: SquareView[] = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const key = `${String(row)},${String(col)}`;
      const kind = layout.squares[row * layout.size + col];
      const premium = kind === undefined || kind === 'plain' ? null : kind;
      const start = row === layout.start.row && col === layout.start.col;
      const char = board[row]?.charAt(col) ?? '.';
      const pendingTile = pending.get(key);
      let tile: TileView | null = null;
      if (char !== '.') {
        const owner = owners[key];
        tile = {
          ...tileOf(char, letters),
          owner: owner === undefined ? null : owner === human ? 'you' : 'opponent',
          pending: false,
          lastMove: last.has(key),
        };
      } else if (pendingTile !== undefined) {
        tile = { ...tileOf(pendingTile, letters), owner: null, pending: true, lastMove: false };
      }
      squares.push({ row, col, premium, start, tile });
    }
  }
  return squares;
}

const n = (value: number): string => String(Math.round(value * 100) / 100);

function circle(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)} ${n(cy)} a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0 a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0 Z`;
}

function diamond(cx: number, cy: number, r: number): string {
  return `M${n(cx)} ${n(cy - r)} L${n(cx + r)} ${n(cy)} L${n(cx)} ${n(cy + r)} L${n(cx - r)} ${n(cy)} Z`;
}

function star(cx: number, cy: number, r: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? r : r * 0.45;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push(`${n(cx + radius * Math.cos(angle))} ${n(cy + radius * Math.sin(angle))}`);
  }
  return `M${points.join(' L')} Z`;
}

/**
 * The premium shape motif of a square at (x, y) of side `cell`, as an SVG path (E-1.4 §2.5): DL one ring, TL two
 * rings, DW one diamond, TW two diamonds, start = star over diamond. Empty for a plain square.
 */
export function motifPath(
  kind: PremiumKind | null,
  start: boolean,
  x: number,
  y: number,
  cell: number,
): string {
  const cx = x + cell / 2;
  const cy = y + cell / 2;
  switch (kind) {
    case 'DL':
      return circle(cx, cy, cell * 0.36);
    case 'TL':
      return `${circle(cx, cy, cell * 0.38)} ${circle(cx, cy, cell * 0.27)}`;
    case 'DW':
      return start
        ? `${diamond(cx, cy, cell * 0.42)} ${star(cx, cy, cell * 0.24)}`
        : diamond(cx, cy, cell * 0.42);
    case 'TW':
      return `${diamond(cx, cy, cell * 0.44)} ${diamond(cx, cy, cell * 0.3)}`;
    case null:
      return '';
  }
}

/** Square fill: the premium tint, or the board background. */
export function premiumFill(
  kind: PremiumKind | null,
  palette: Pick<
    BoardPalette,
    'bg' | 'premiumDlTint' | 'premiumTlTint' | 'premiumDwTint' | 'premiumTwTint'
  >,
): HexColor {
  switch (kind) {
    case 'DL':
      return palette.premiumDlTint;
    case 'TL':
      return palette.premiumTlTint;
    case 'DW':
      return palette.premiumDwTint;
    case 'TW':
      return palette.premiumTwTint;
    case null:
      return palette.bg;
  }
}

type T = (key: MessageKey, params?: MessageParams) => string;

const PREMIUM_NAME: Readonly<Record<PremiumKind, MessageKey>> = {
  DL: 'a11y.premium.dl',
  TL: 'a11y.premium.tl',
  DW: 'a11y.premium.dw',
  TW: 'a11y.premium.tw',
};

/** Screen-reader label of a square (D-21, E-1.4 §2.6): 1-based row and column. */
export function squareLabel(t: T, square: SquareView, botName: string): string {
  const row = square.row + 1;
  const col = square.col + 1;
  const { tile } = square;
  if (tile === null) {
    const premium = square.start
      ? t('a11y.square.start')
      : square.premium === null
        ? t('a11y.square.plain')
        : t(PREMIUM_NAME[square.premium]);
    return t('a11y.square.empty', { premium, row, col });
  }
  const name = tile.isBlank
    ? t('a11y.tile.blank_placed', { letter: tile.letter })
    : t('a11y.tile.letter', { letter: tile.letter, points: tile.value });
  const states: string[] = [];
  if (tile.pending) states.push(t('a11y.square.state.pending'));
  else if (tile.owner === 'you') states.push(t('a11y.square.state.you'));
  else if (tile.owner === 'opponent') states.push(t('a11y.square.state.bot', { bot: botName }));
  if (tile.lastMove) states.push(t('a11y.square.state.last'));
  return t('a11y.square.occupied', { tile: name, row, col, state: states.join(', ') });
}
