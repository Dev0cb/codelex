/**
 * Seeded states for the negative harness, and an independent brute-force generator of legal PLACE_WORDs.
 *
 * States come from `createMatch` + random-legal play (test/support/play.ts, which picks its moves through the
 * engine). That is fine for *reaching* states. The moves the harness then tests are never chosen through
 * `evaluateMove`: legal ones come from `legalPool` below, which enumerates words x squares x directions and
 * keeps those the independent oracle accepts.
 */
import { apply } from '../../src/match/apply.js';
import { createMatch } from '../../src/match/create.js';
import type { Action, MatchState, Placement } from '../../src/types.js';
import { chooseAction, harnessRng, simConfig, SIM_CTX } from '../support/play.js';
import { ALL_PLAYABLE, NEGATIVE_LEXICON } from './lexicon.js';
import { judge, SIZE, START } from './oracle.js';

export interface Snapshot {
  readonly label: string;
  readonly state: MatchState;
}

const SEATS = [2, 2, 3, 4, 2, 3, 4, 2];
/** Plies at which a snapshot is taken (0 = the opening position). */
const PLIES = new Set([0, 3, 7, 12, 18, 26, 36]);

function seedOf(i: number): string {
  return (i * 0x9e3779b1 + 777).toString(16).padStart(16, '0').slice(-16);
}

/** `matches` seeded matches; snapshots mid-game, at the first bag < 7, after an FFA resign, and at the end. */
export function buildSnapshots(matches: number): Snapshot[] {
  const out: Snapshot[] = [];
  for (let m = 0; m < matches; m += 1) {
    const seats = SEATS[m % SEATS.length] ?? 2;
    const seed = seedOf(m);
    const created = createMatch(simConfig(seed, seats), SIM_CTX);
    if (!created.ok) throw new Error(`createMatch failed for ${seed}`);
    let state = created.value.state;
    const rng = harnessRng(seed);
    let lowBag = false;
    for (let ply = 0; state.status === 'in_progress' && ply < 400; ply += 1) {
      if (PLIES.has(ply)) out.push({ label: `m${String(m)}-ply${String(ply)}`, state });
      if (!lowBag && state.bag.length < 7) {
        lowBag = true;
        out.push({ label: `m${String(m)}-lowbag`, state });
      }
      if (ply === 9 && seats > 2) {
        const resigned = apply(
          state,
          { seat: (state.seatOnTurn + 1) % seats, type: 'RESIGN' },
          SIM_CTX,
        );
        if (resigned.ok) out.push({ label: `m${String(m)}-resigned`, state: resigned.value.state });
      }
      const r = apply(state, chooseAction(state, rng), SIM_CTX);
      if (!r.ok) throw new Error(`seed ${seed}: harness move rejected`);
      state = r.value.state;
    }
    out.push({ label: `m${String(m)}-final`, state });
  }
  return out;
}

const has = (form: string): boolean => NEGATIVE_LEXICON.has(form);

/**
 * Tiles that spell `word` from (row, col) along a direction, spending rack letters (blanks when a letter is
 * missing) on empty squares and reusing board letters. Undefined when the word cannot be spelled from this rack.
 */
function spell(
  state: MatchState,
  rack: string,
  word: string,
  row: number,
  col: number,
  vertical: boolean,
): Placement[] | undefined {
  const pool = Array.from(rack);
  const tiles: Placement[] = [];
  for (let k = 0; k < word.length; k += 1) {
    const r = vertical ? row + k : row;
    const c = vertical ? col : col + k;
    if (r >= SIZE || c >= SIZE) return undefined;
    const letter = word.charAt(k);
    const square = state.board[r]?.charAt(c) ?? '.';
    if (square !== '.') {
      if (square.toUpperCase() !== letter) return undefined;
      continue;
    }
    let at = pool.indexOf(letter);
    let tile = letter;
    if (at === -1) {
      at = pool.indexOf('?');
      tile = letter.toLowerCase();
    }
    if (at === -1) return undefined;
    pool.splice(at, 1);
    tiles.push({ row: r, col: c, tile: tile as Placement['tile'] });
  }
  return tiles.length >= 1 && tiles.length <= 7 ? tiles : undefined;
}

/**
 * Up to `limit` PLACE_WORDs the oracle accepts for the seat on turn: every playable word x every start square x
 * both directions that touches the board (or covers the start square when the board is empty), sub-sampled with
 * a fixed stride so the pool is spread over the board and the vocabulary.
 */
export function legalPool(state: MatchState, limit: number): Action[] {
  const seat = state.seatOnTurn;
  const rack = state.seats[seat]?.rack ?? '';
  const empty = state.board.every((row) => /^\.+$/.test(row));
  const candidates: Placement[][] = [];
  for (const word of ALL_PLAYABLE) {
    for (const vertical of [false, true]) {
      for (let row = 0; row < SIZE; row += 1) {
        for (let col = 0; col < SIZE; col += 1) {
          const tiles = spell(state, rack, word, row, col, vertical);
          if (tiles === undefined) continue;
          if (empty && !tiles.some((t) => t.row === START && t.col === START)) continue;
          candidates.push(tiles);
        }
      }
    }
  }
  const found: Action[] = [];
  const stride = Math.max(1, Math.floor(candidates.length / (limit * 4)));
  for (let i = 0; i < candidates.length && found.length < limit; i += stride) {
    const action: Action = { seat, type: 'PLACE_WORD', tiles: candidates[i] as Placement[] };
    if (judge(state, action, has).ok) found.push(action);
  }
  if (found.length < limit) {
    // Fall back to the not-yet-visited candidates (small pools).
    for (let i = 1; i < candidates.length && found.length < limit; i += 1) {
      if (i % stride === 0) continue;
      const action: Action = { seat, type: 'PLACE_WORD', tiles: candidates[i] as Placement[] };
      if (judge(state, action, has).ok) found.push(action);
    }
  }
  return found;
}
