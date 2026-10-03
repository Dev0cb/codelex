/**
 * Independent brute-force legality oracle (sprint Q3), written from GAME_RULES (R-TURN-001/002/003/006,
 * R-BOARD-001/004, R-BAG-003/005/006, R-END-002) and the §8.3 precedence only.
 *
 * It imports nothing from `src/`: no `evaluateMove`, no `apply`, no placement/validation internals, not even the
 * layout constants (the board is 15x15 with the start square at (7,7) by R-BOARD-001/§2.1; the rack size 7 and
 * the exchange threshold 7 are restated from R-BAG-003 / R-TURN-001). Its only dependency on the engine's world
 * is the lexicon's `has`, passed in, and plain board/rack data read from the state.
 */

export const SIZE = 15;
export const START = 7;
export const RACK_SIZE = 7;
export const MIN_BAG_FOR_EXCHANGE = 7;

/** The slice of a `MatchState` the oracle reads. Structural, so tests can pass a real state. */
export interface OracleState {
  readonly status: 'in_progress' | 'finished';
  readonly seatOnTurn: number;
  readonly board: readonly string[];
  readonly bag: string;
  readonly config: { readonly seats: number };
  readonly seats: readonly { readonly rack: string; readonly status: string }[];
}

interface OracleAction {
  readonly seat: unknown;
  readonly type: string;
  readonly tiles?: readonly unknown[];
}

export type OracleVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: string;
      /** Violation (placement / exchange / malformed) when the code has one. */
      readonly violation?: string;
      /** `rack`: the missing tiles, sorted. */
      readonly missing?: string;
      /** `not_in_lexicon`: the non-playable formed words in main-first order. */
      readonly words?: readonly { readonly form: string; readonly main: boolean }[];
    };

const reject = (code: string, extra: Record<string, unknown> = {}): OracleVerdict => ({
  ok: false,
  code,
  ...extra,
});

const isLetter = (c: unknown): c is string => typeof c === 'string' && /^[A-Za-z]$/.test(c);

function sortedChars(s: string): string {
  return Array.from(s)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .join('');
}

/** Tiles of `need` that the multiset `have` cannot supply, sorted. */
function missingFrom(have: string, need: readonly string[]): string {
  const pool = new Map<string, number>();
  for (const c of have) pool.set(c, (pool.get(c) ?? 0) + 1);
  const missing: string[] = [];
  for (const n of need) {
    const left = pool.get(n) ?? 0;
    if (left > 0) pool.set(n, left - 1);
    else missing.push(n);
  }
  return sortedChars(missing.join(''));
}

interface Tile {
  readonly row: number;
  readonly col: number;
  readonly tile: string;
}

/** Shape check of an untrusted action (§8.3 step 3), for the shape faults the harness can produce. */
function malformed(action: OracleAction, seats: number): OracleVerdict | undefined {
  const seat = action.seat;
  if (typeof seat !== 'number' || !Number.isSafeInteger(seat) || seat < 0 || seat >= seats) {
    return reject('malformed', { violation: 'seat_out_of_range' });
  }
  if (action.type === 'PLACE_WORD') {
    for (const t of action.tiles ?? []) {
      const { row, col, tile } = t as Tile;
      if (!Number.isSafeInteger(row) || !Number.isSafeInteger(col)) {
        return reject('malformed', { violation: 'bad_coordinate' });
      }
      if (tile === '?') return reject('malformed', { violation: 'blank_undesignated' });
      if (!isLetter(tile)) return reject('malformed', { violation: 'bad_tile' });
    }
  }
  if (action.type === 'EXCHANGE') {
    for (const t of action.tiles ?? []) {
      if (!(isLetter(t) && t === t.toUpperCase()) && t !== '?') {
        return reject('malformed', { violation: 'bad_tile' });
      }
    }
  }
  return undefined;
}

/** Text (uppercase) of the maximal run of occupied squares through (row, col) along a direction. */
function runThrough(
  grid: readonly (readonly string[])[],
  row: number,
  col: number,
  vertical: boolean,
): string {
  let r = row;
  let c = col;
  const dr = vertical ? 1 : 0;
  const dc = vertical ? 0 : 1;
  while (r - dr >= 0 && c - dc >= 0 && grid[r - dr]?.[c - dc] !== '.') {
    r -= dr;
    c -= dc;
  }
  let text = '';
  while (r < SIZE && c < SIZE && grid[r]?.[c] !== '.') {
    text += (grid[r]?.[c] ?? '.').toUpperCase();
    r += dr;
    c += dc;
  }
  return text;
}

export function judge(
  state: OracleState,
  rawAction: unknown,
  has: (form: string) => boolean,
): OracleVerdict {
  // 2. match_over, for every action including RESIGN.
  if (state.status === 'finished') return reject('match_over');
  const action = rawAction as OracleAction;
  // 3. malformed.
  const bad = malformed(action, state.config.seats);
  if (bad !== undefined) return bad;
  const seat = action.seat as number;
  const seatState = state.seats[seat];
  // 4. not_your_turn: a retired seat for everything; RESIGN from an active seat is always allowed.
  if (seatState === undefined || seatState.status !== 'active') return reject('not_your_turn');
  if (action.type === 'RESIGN') return { ok: true };
  if (seat !== state.seatOnTurn) return reject('not_your_turn');
  if (action.type === 'PASS') return { ok: true };

  const rack = seatState.rack;
  if (action.type === 'EXCHANGE') {
    const tiles = (action.tiles ?? []) as string[];
    if (tiles.length < 1 || tiles.length > RACK_SIZE) {
      return reject('exchange', { violation: 'tile_count' });
    }
    if (state.bag.length < MIN_BAG_FOR_EXCHANGE) {
      return reject('exchange', { violation: 'bag_too_small' });
    }
    const missing = missingFrom(rack, tiles);
    return missing === '' ? { ok: true } : reject('rack', { missing });
  }
  return judgePlacement(state, rack, (action.tiles ?? []) as Tile[], has);
}

function judgePlacement(
  state: OracleState,
  rack: string,
  tiles: readonly Tile[],
  has: (form: string) => boolean,
): OracleVerdict {
  const violation = (v: string): OracleVerdict => reject('placement', { violation: v });
  const occupied = (r: number, c: number): boolean =>
    r >= 0 && c >= 0 && r < SIZE && c < SIZE && (state.board[r]?.[c] ?? '.') !== '.';

  if (tiles.length < 1 || tiles.length > RACK_SIZE) return violation('tile_count');
  if (tiles.some((t) => t.row < 0 || t.row >= SIZE || t.col < 0 || t.col >= SIZE)) {
    return violation('off_board');
  }
  const keys = new Set(tiles.map((t) => `${String(t.row)},${String(t.col)}`));
  if (keys.size !== tiles.length) return violation('duplicate_square');

  // rack (R-TURN-002 multiset; a lowercase tile spends a blank, R-BAG-006)
  const needed = tiles.map((t) => (t.tile === t.tile.toLowerCase() ? '?' : t.tile));
  const missing = missingFrom(rack, needed);
  if (missing !== '') return reject('rack', { missing });

  if (tiles.some((t) => occupied(t.row, t.col))) return violation('occupied');
  const sameRow = tiles.every((t) => t.row === tiles[0]?.row);
  const sameCol = tiles.every((t) => t.col === tiles[0]?.col);
  if (!sameRow && !sameCol) return violation('not_collinear');
  const vertical = !sameRow;
  if (tiles.length > 1) {
    const lo = Math.min(...tiles.map((t) => (vertical ? t.row : t.col)));
    const hi = Math.max(...tiles.map((t) => (vertical ? t.row : t.col)));
    const fixed = vertical ? (tiles[0]?.col ?? 0) : (tiles[0]?.row ?? 0);
    for (let i = lo; i <= hi; i += 1) {
      const r = vertical ? i : fixed;
      const c = vertical ? fixed : i;
      if (!keys.has(`${String(r)},${String(c)}`) && !occupied(r, c)) return violation('gap');
    }
  }
  const boardEmpty = state.board.every((row) => /^\.+$/.test(row));
  if (boardEmpty) {
    if (!keys.has(`${String(START)},${String(START)}`)) return violation('start_not_covered');
    if (tiles.length < 2) return violation('first_move_too_short');
  } else {
    const touches = tiles.some((t) =>
      [
        [t.row - 1, t.col],
        [t.row + 1, t.col],
        [t.row, t.col - 1],
        [t.row, t.col + 1],
      ].some(([r, c]) => occupied(r ?? -1, c ?? -1)),
    );
    if (!touches) return violation('not_connected');
  }

  // Formed words (R-TURN-006) on the board after the placement.
  const grid: string[][] = state.board.map((row) => Array.from(row));
  for (const t of tiles) (grid[t.row] as string[])[t.col] = t.tile;
  const first = tiles[0] as Tile;
  let mainVertical = vertical;
  if (tiles.length === 1) {
    const h = runThrough(grid, first.row, first.col, false).length;
    const v = runThrough(grid, first.row, first.col, true).length;
    mainVertical = v > h; // tie -> row
  }
  const formed: { form: string; main: boolean }[] = [];
  const mainRun = runThrough(grid, first.row, first.col, mainVertical);
  if (mainRun.length >= 2) formed.push({ form: mainRun, main: true });
  const ordered = [...tiles].sort((a, b) => a.row - b.row || a.col - b.col);
  for (const t of ordered) {
    const cross = runThrough(grid, t.row, t.col, !mainVertical);
    if (cross.length >= 2) formed.push({ form: cross, main: false });
  }
  const unplayable = formed.filter((w) => !has(w.form));
  if (unplayable.length > 0) return reject('not_in_lexicon', { words: unplayable });
  return { ok: true };
}
