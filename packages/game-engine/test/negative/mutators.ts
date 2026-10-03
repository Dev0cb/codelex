/**
 * Mutators: turn a legal move (from `legalPool`) into one that should be illegal.
 *
 * A mutant that has a `expect` carries a rejection that follows from API note §8.3 and GAME_RULES alone, whatever
 * the board: the test asserts `apply` returns exactly that. Mutants without one (shift, random) are judged by the
 * oracle only. Every mutator is a pure function of its inputs and a non-negative integer selector `p` (so
 * fast-check drives and shrinks it); `undefined` means "not applicable to this state/move".
 */
import type { Action, MatchState, Placement } from '../../src/types.js';
import { judge, SIZE, START } from './oracle.js';

export type MutationClass =
  | 'shift'
  | 'drop_tile'
  | 'swap_main_word'
  | 'swap_cross_word'
  | 'foreign_tile'
  | 'wrong_seat'
  | 'bad_exchange'
  | 'occupied'
  | 'off_board'
  | 'start_not_covered'
  | 'first_move_too_short'
  | 'not_connected';

export interface Expectation {
  readonly code: string;
  readonly violation?: string;
  readonly missing?: string;
}

export interface Mutant {
  readonly klass: MutationClass;
  readonly action: unknown;
  readonly expect?: Expectation;
}

type PlaceWord = Extract<Action, { type: 'PLACE_WORD' }>;
const isPlace = (a: Action): a is PlaceWord => a.type === 'PLACE_WORD';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const withTiles = (a: PlaceWord, tiles: readonly Placement[]): PlaceWord => ({ ...a, tiles });

/** Moves every tile by (dr, dc). */
function translate(tiles: readonly Placement[], dr: number, dc: number): Placement[] {
  return tiles.map((t) => ({ ...t, row: t.row + dr, col: t.col + dc }));
}

const sortedTiles = (a: PlaceWord): Placement[] =>
  [...a.tiles].sort((x, y) => x.row - y.row || x.col - y.col);

/** Rack letters left once the other tiles of the move are paid for (blank counted as '?'). */
function rackWithout(rack: string, tiles: readonly Placement[]): string[] {
  const pool = Array.from(rack);
  for (const t of tiles) {
    const at = pool.indexOf(t.tile === t.tile.toLowerCase() ? '?' : t.tile);
    if (at >= 0) pool.splice(at, 1);
  }
  return pool;
}

/** Shift the whole move one square up/down/left/right. Outcome judged by the oracle. */
export function shiftByOne(legal: Action, p: number): Mutant | undefined {
  if (!isPlace(legal)) return undefined;
  const [dr, dc] = (
    [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ] as const
  )[p % 4] as readonly [number, number];
  return { klass: 'shift', action: withTiles(legal, translate(legal.tiles, dr, dc)) };
}

/** Remove an interior tile of a >= 3 tile move: the square it leaves is an empty hole, so `gap`. */
export function dropTile(legal: Action, p: number): Mutant | undefined {
  if (!isPlace(legal) || legal.tiles.length < 3) return undefined;
  const tiles = sortedTiles(legal);
  const skip = 1 + (p % (tiles.length - 2));
  return {
    klass: 'drop_tile',
    action: withTiles(
      legal,
      tiles.filter((_, i) => i !== skip),
    ),
    expect: { code: 'placement', violation: 'gap' },
  };
}

/**
 * Replace one tile's letter by another letter the seat can pay for. Only emitted when the oracle says the
 * result forms a non-playable word; classed by whether the main word is among the offenders.
 */
export function swapLetter(
  state: MatchState,
  legal: Action,
  p: number,
  want: 'main' | 'cross',
): Mutant | undefined {
  if (!isPlace(legal)) return undefined;
  const tiles = sortedTiles(legal);
  const rack = state.seats[legal.seat]?.rack ?? '';
  const has = (form: string): boolean => lexiconHas(form);
  for (let attempt = 0; attempt < tiles.length * 26; attempt += 1) {
    const i = (p + attempt) % tiles.length;
    const letter = LETTERS.charAt(Math.floor((p + attempt) / tiles.length) % 26);
    const original = tiles[i] as Placement;
    if (original.tile.toUpperCase() === letter) continue;
    const others = tiles.filter((_, k) => k !== i);
    if (!rackWithout(rack, others).includes(letter)) continue;
    const swapped = tiles.map((t, k) =>
      k === i ? { ...t, tile: letter as Placement['tile'] } : t,
    );
    const action = withTiles(legal, swapped);
    const verdict = judge(state, action, has);
    if (verdict.ok || verdict.code !== 'not_in_lexicon') continue;
    const mainBad = verdict.words?.some((w) => w.main) === true;
    if ((want === 'main') !== mainBad) continue;
    return {
      klass: want === 'main' ? 'swap_main_word' : 'swap_cross_word',
      action,
      expect: { code: 'not_in_lexicon' },
    };
  }
  return undefined;
}

let lexiconHas: (form: string) => boolean = () => false;
/** The lexicon the swap mutator consults to find a non-word (set once by the test file). */
export function useLexicon(has: (form: string) => boolean): void {
  lexiconHas = has;
}

/** Spend a tile the rack does not hold (uppercase letter the seat lacks): `rack` with that letter missing. */
export function foreignTile(state: MatchState, legal: Action, p: number): Mutant | undefined {
  if (!isPlace(legal)) return undefined;
  const tiles = sortedTiles(legal);
  const rack = state.seats[legal.seat]?.rack ?? '';
  for (let attempt = 0; attempt < tiles.length * 26; attempt += 1) {
    const i = (p + attempt) % tiles.length;
    const letter = LETTERS.charAt(Math.floor((p + attempt) / tiles.length) % 26);
    const others = tiles.filter((_, k) => k !== i);
    if (rackWithout(rack, others).includes(letter)) continue;
    return {
      klass: 'foreign_tile',
      action: withTiles(
        legal,
        tiles.map((t, k) => (k === i ? { ...t, tile: letter as Placement['tile'] } : t)),
      ),
      expect: { code: 'rack', missing: letter },
    };
  }
  return undefined;
}

/** The same action by a seat that is not on turn (active or retired): `not_your_turn`. */
export function wrongSeat(state: MatchState, legal: Action, p: number): Mutant | undefined {
  const seats = state.config.seats;
  if (seats < 2 || legal.type === 'RESIGN') return undefined;
  const seat = (state.seatOnTurn + 1 + (p % (seats - 1))) % seats;
  return { klass: 'wrong_seat', action: { ...legal, seat }, expect: { code: 'not_your_turn' } };
}

/** Exchanges that break the rules: zero tiles, too many, bag below 7, or tiles the rack does not hold. */
export function badExchange(state: MatchState, p: number): Mutant | undefined {
  const seat = state.seatOnTurn;
  const rack = state.seats[seat]?.rack ?? '';
  const lowBag = state.bag.length < 7;
  const action = (tiles: readonly string[]): unknown => ({ seat, type: 'EXCHANGE', tiles });
  switch (p % 4) {
    case 0:
      return {
        klass: 'bad_exchange',
        action: action([]),
        expect: { code: 'exchange', violation: 'tile_count' },
      };
    case 1:
      return {
        klass: 'bad_exchange',
        action: action(
          Array.from({ length: 8 }, (_, i) => rack.charAt(i % Math.max(1, rack.length)) || 'E'),
        ),
        expect: { code: 'exchange', violation: 'tile_count' },
      };
    case 2: {
      // legal-looking exchange of rack tiles: rejected only because the bag is below the threshold
      if (!lowBag || rack.length === 0) return undefined;
      const count = 1 + (p % rack.length);
      return {
        klass: 'bad_exchange',
        action: action(Array.from(rack).slice(0, count)),
        expect: { code: 'exchange', violation: 'bag_too_small' },
      };
    }
    default: {
      const absent = Array.from(LETTERS).find((l) => !rack.includes(l)) ?? 'Z';
      return {
        klass: 'bad_exchange',
        action: action([absent]),
        expect: lowBag
          ? { code: 'exchange', violation: 'bag_too_small' }
          : { code: 'rack', missing: absent },
      };
    }
  }
}

/** Put one tile (keeping its letter) on a square that already holds a tile: `occupied`. */
export function onOccupied(state: MatchState, legal: Action, p: number): Mutant | undefined {
  if (!isPlace(legal)) return undefined;
  const squares: [number, number][] = [];
  state.board.forEach((row, r) => {
    for (let c = 0; c < row.length; c += 1) if (row.charAt(c) !== '.') squares.push([r, c]);
  });
  if (squares.length === 0) return undefined;
  const [row, col] = squares[p % squares.length] as [number, number];
  const tiles = sortedTiles(legal);
  const i = Math.floor(p / squares.length) % tiles.length;
  return {
    klass: 'occupied',
    action: withTiles(
      legal,
      tiles.map((t, k) => (k === i ? { ...t, row, col } : t)),
    ),
    expect: { code: 'placement', violation: 'occupied' },
  };
}

/** Move one tile off the board: `off_board`. */
export function offBoard(legal: Action, p: number): Mutant | undefined {
  if (!isPlace(legal)) return undefined;
  const tiles = sortedTiles(legal);
  const i = p % tiles.length;
  const t = tiles[i] as Placement;
  const spots: [number, number][] = [
    [-1, t.col],
    [SIZE, t.col],
    [t.row, -1],
    [t.row, SIZE],
    [-3, -3],
    [SIZE + 40, 2],
  ];
  const [row, col] = spots[Math.floor(p / tiles.length) % spots.length] as [number, number];
  return {
    klass: 'off_board',
    action: withTiles(
      legal,
      tiles.map((x, k) => (k === i ? { ...x, row, col } : x)),
    ),
    expect: { code: 'placement', violation: 'off_board' },
  };
}

/** Opening move that does not cover the centre (shifted away), or a lone tile on the centre. */
export function badOpening(state: MatchState, legal: Action, p: number): Mutant | undefined {
  if (!isPlace(legal) || !state.board.every((row) => /^\.+$/.test(row))) return undefined;
  const tiles = sortedTiles(legal);
  if (p % 5 === 4) {
    const [first] = tiles;
    if (first === undefined) return undefined;
    return {
      klass: 'first_move_too_short',
      action: withTiles(legal, [{ ...first, row: START, col: START }]),
      expect: { code: 'placement', violation: 'first_move_too_short' },
    };
  }
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const k = (p + attempt) % 25;
    const dr = (k % 5) - 2;
    const dc = Math.floor(k / 5) - 2;
    const moved = translate(tiles, dr, dc);
    const inBoard = moved.every((t) => t.row >= 0 && t.col >= 0 && t.row < SIZE && t.col < SIZE);
    if (inBoard && !moved.some((t) => t.row === START && t.col === START)) {
      return {
        klass: 'start_not_covered',
        action: withTiles(legal, moved),
        expect: { code: 'placement', violation: 'start_not_covered' },
      };
    }
  }
  return undefined;
}

/** Carry a contiguous move to empty squares that touch nothing: `not_connected`. */
export function disconnected(state: MatchState, legal: Action, p: number): Mutant | undefined {
  if (!isPlace(legal) || state.board.every((row) => /^\.+$/.test(row))) return undefined;
  const tiles = sortedTiles(legal);
  const first = tiles[0] as Placement;
  const last = tiles[tiles.length - 1] as Placement;
  // Contiguous placement (no board tile inside the span): else the translated move would have a hole (`gap`).
  if (Math.abs(last.row - first.row) + Math.abs(last.col - first.col) !== tiles.length - 1) {
    return undefined;
  }
  const occupied = (r: number, c: number): boolean =>
    r >= 0 && c >= 0 && r < SIZE && c < SIZE && (state.board[r]?.charAt(c) ?? '.') !== '.';
  const span = 2 * SIZE - 1;
  for (let attempt = 0; attempt < span * span; attempt += 1) {
    const k = (p * 37 + attempt) % (span * span);
    const dr = (k % span) - (SIZE - 1);
    const dc = Math.floor(k / span) - (SIZE - 1);
    const moved = translate(tiles, dr, dc);
    const ok = moved.every(
      (t) =>
        t.row >= 0 &&
        t.col >= 0 &&
        t.row < SIZE &&
        t.col < SIZE &&
        !occupied(t.row, t.col) &&
        !occupied(t.row - 1, t.col) &&
        !occupied(t.row + 1, t.col) &&
        !occupied(t.row, t.col - 1) &&
        !occupied(t.row, t.col + 1),
    );
    if (ok) {
      return {
        klass: 'not_connected',
        action: withTiles(legal, moved),
        expect: { code: 'placement', violation: 'not_connected' },
      };
    }
  }
  return undefined;
}
