/**
 * PLACE_WORD validation (R-TURN-002, R-TURN-003, R-TURN-006, R-BOARD-001, R-BOARD-004, R-BAG-006) in the
 * precedence of API note §8.3 step 5: `placement` tile_count / off_board / duplicate_square → `rack` →
 * `placement` occupied / not_collinear / gap / start_not_covered / first_move_too_short / not_connected →
 * `not_in_lexicon`. Works on a board and a rack (not a state) so that `apply` and `evaluateMove` share it.
 */
import type { FormRef } from '@codelex/lexicon/index';
import { err, ok, type Result } from '@codelex/config/result';
import { notInLexicon, placementRejection, rackRejection } from '../errors.js';
import { RULES } from '../rules/constants.js';
import { EMPTY_SQUARE, letterOf, rackTileOf, removeTiles } from '../tiles.js';
import type {
  BoardRow,
  BoardTile,
  Direction,
  EngineLexicon,
  Layout,
  Placement,
  Rejection,
  Square,
  TileString,
} from '../types.js';

/** One square of a formed word. */
export interface WordCell {
  readonly row: number;
  readonly col: number;
  readonly tile: BoardTile;
  /** Newly placed this turn (premiums apply only to these, R-SCORE-001). */
  readonly isNew: boolean;
}

/** A word formed by a placement (R-TURN-006), before scoring. */
export interface FormedWord {
  /** Uppercase, blanks read as their designated letter (R-BAG-006 d). */
  readonly form: string;
  readonly main: boolean;
  readonly start: Square;
  readonly direction: Direction;
  readonly cells: readonly WordCell[];
}

/** A formed word resolved in the lexicon. */
export interface ResolvedWord extends FormedWord {
  readonly ref: FormRef;
}

/** Geometry and rack outcome, before the lexicon (what the lexicon-free preview needs, R-SCORE-009). */
export interface PlacementGeometry {
  /** Canonical tiles (as given: callers pass canonical actions). */
  readonly tiles: readonly Placement[];
  /** Main word first, then cross-words by the (row, col) of their new tile. Never empty. */
  readonly words: readonly FormedWord[];
  /** Rack after removing the placed tiles, sorted (before refill). */
  readonly rackAfter: TileString;
}

export interface CheckedPlacement extends PlacementGeometry {
  readonly words: readonly ResolvedWord[];
}

export interface PlacementInput {
  readonly board: readonly BoardRow[];
  readonly layout: Layout;
  readonly rack: TileString;
  /** Canonical tiles: sorted by (row, col). Shape already checked (`parseAction`). */
  readonly tiles: readonly Placement[];
}

const STEP: Readonly<Record<Direction, Square>> = {
  row: { row: 0, col: 1 },
  col: { row: 1, col: 0 },
};

function read(board: readonly BoardRow[], row: number, col: number): string {
  return board[row]?.charAt(col) ?? '';
}

function isOccupied(board: readonly BoardRow[], row: number, col: number): boolean {
  const square = read(board, row, col);
  return square !== '' && square !== EMPTY_SQUARE;
}

/** `board` with `tiles` written in; unchanged rows are shared with the input. */
export function placeTiles(board: readonly BoardRow[], tiles: readonly Placement[]): BoardRow[] {
  const rows = [...board];
  for (const { row, col, tile } of tiles) {
    const line = rows[row] ?? '';
    rows[row] = line.slice(0, col) + tile + line.slice(col + 1);
  }
  return rows;
}

function isBoardEmpty(board: readonly BoardRow[]): boolean {
  return board.every((line) => /^\.*$/.test(line));
}

/** The maximal run through `(row, col)` along `direction` on `board` (which already holds the new tiles). */
function runThrough(
  board: readonly BoardRow[],
  isNew: (row: number, col: number) => boolean,
  row: number,
  col: number,
  direction: Direction,
): readonly WordCell[] {
  const { row: dr, col: dc } = STEP[direction];
  let r = row;
  let c = col;
  while (isOccupied(board, r - dr, c - dc)) {
    r -= dr;
    c -= dc;
  }
  const cells: WordCell[] = [];
  while (isOccupied(board, r, c)) {
    cells.push({ row: r, col: c, tile: read(board, r, c) as BoardTile, isNew: isNew(r, c) });
    r += dr;
    c += dc;
  }
  return cells;
}

function toWord(cells: readonly WordCell[], direction: Direction, main: boolean): FormedWord {
  const first = cells[0] as WordCell;
  return {
    form: cells.map((cell) => letterOf(cell.tile)).join(''),
    main,
    start: { row: first.row, col: first.col },
    direction,
    cells,
  };
}

const other = (direction: Direction): Direction => (direction === 'row' ? 'col' : 'row');

/**
 * Geometry and rack checks plus formed-word extraction (no lexicon). Fails with `placement` or `rack` in the
 * §8.3 order.
 */
export function checkPlacementGeometry(
  input: PlacementInput,
): Result<PlacementGeometry, Rejection> {
  const { board, layout, rack, tiles } = input;
  if (tiles.length === 0 || tiles.length > RULES.rackSize) {
    return err(placementRejection('tile_count'));
  }
  if (tiles.some((t) => t.row < 0 || t.col < 0 || t.row >= layout.size || t.col >= layout.size)) {
    return err(placementRejection('off_board'));
  }
  for (let i = 1; i < tiles.length; i += 1) {
    const a = tiles[i - 1] as Placement;
    const b = tiles[i] as Placement;
    if (a.row === b.row && a.col === b.col) return err(placementRejection('duplicate_square'));
  }
  const { rest, missing } = removeTiles(
    rack,
    tiles.map((t) => rackTileOf(t.tile)),
  );
  if (missing !== '') return err(rackRejection(missing));
  if (tiles.some((t) => isOccupied(board, t.row, t.col))) {
    return err(placementRejection('occupied'));
  }

  const first = tiles[0] as Placement;
  const last = tiles[tiles.length - 1] as Placement;
  const sameRow = tiles.every((t) => t.row === first.row);
  const sameCol = tiles.every((t) => t.col === first.col);
  if (!sameRow && !sameCol) return err(placementRejection('not_collinear'));

  const after = placeTiles(board, tiles);
  const line: Direction = sameRow ? 'row' : 'col';
  const { row: dr, col: dc } = STEP[line];
  for (let r = first.row, c = first.col; r !== last.row || c !== last.col; r += dr, c += dc) {
    if (!isOccupied(after, r, c)) return err(placementRejection('gap'));
  }

  const firstMove = isBoardEmpty(board);
  if (firstMove) {
    const { row: sr, col: sc } = layout.start;
    if (!tiles.some((t) => t.row === sr && t.col === sc)) {
      return err(placementRejection('start_not_covered'));
    }
    if (tiles.length < RULES.minFirstMoveTiles) {
      return err(placementRejection('first_move_too_short'));
    }
  } else {
    const touches = tiles.some(
      (t) =>
        isOccupied(board, t.row - 1, t.col) ||
        isOccupied(board, t.row + 1, t.col) ||
        isOccupied(board, t.row, t.col - 1) ||
        isOccupied(board, t.row, t.col + 1),
    );
    if (!touches) return err(placementRejection('not_connected'));
  }

  const newSquares = new Set(tiles.map((t) => t.row * layout.size + t.col));
  const isNew = (r: number, c: number): boolean => newSquares.has(r * layout.size + c);

  // R-TURN-006 b: several tiles → their line; one tile → the longer run, ties to the row.
  let mainDirection = line;
  if (tiles.length === 1) {
    const rowRun = runThrough(after, isNew, first.row, first.col, 'row').length;
    const colRun = runThrough(after, isNew, first.row, first.col, 'col').length;
    mainDirection = colRun > rowRun ? 'col' : 'row';
  }
  const words: FormedWord[] = [];
  const mainCells = runThrough(after, isNew, first.row, first.col, mainDirection);
  if (mainCells.length >= 2) words.push(toWord(mainCells, mainDirection, true));
  const cross = other(mainDirection);
  for (const t of tiles) {
    const cells = runThrough(after, isNew, t.row, t.col, cross);
    if (cells.length >= 2) words.push(toWord(cells, cross, false));
  }
  // Unreachable after the checks above (a connected or ≥ 2-tile first move always forms a word); kept so the
  // "a placement must form at least one word" rule (R-TURN-006 c) never depends on that reasoning.
  if (words.length === 0) return err(placementRejection('not_connected'));

  return ok({ tiles, words, rackAfter: rest });
}

/**
 * Full PLACE_WORD check: geometry and rack, then every formed word looked up (R-TURN-003). All non-playable
 * words are listed, main first (API note §8.2).
 */
export function checkPlacement(
  input: PlacementInput,
  lexicon: EngineLexicon,
): Result<CheckedPlacement, Rejection> {
  const geometry = checkPlacementGeometry(input);
  if (!geometry.ok) return geometry;
  const resolved: ResolvedWord[] = [];
  const failures: { form: string; main: boolean }[] = [];
  for (const word of geometry.value.words) {
    const ref = lexicon.lookup(word.form);
    if (ref === undefined) failures.push({ form: word.form, main: word.main });
    else resolved.push({ ...word, ref });
  }
  if (failures.length > 0) return err(notInLexicon(failures));
  return ok({ ...geometry.value, words: resolved });
}
