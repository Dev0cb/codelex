/**
 * Public types of `@codelex/game-engine` for `engineRulesVersion` 1. Normative source:
 * `docs/architecture/notes/game-engine-api.md` §4–§12 (names, shapes and doc comments are the contract).
 * Everything reachable from `MatchState` is hashed (API-2) and uses only objects, arrays, ASCII strings and safe
 * integers (API-3).
 */
import type {
  DefinitionHash,
  Difficulty,
  LexiconIndex,
  LexiconVersion,
} from '@codelex/lexicon/index';
import type { ENGINE_RULES_VERSION } from './version.js';

export type { DefinitionHash, Difficulty, LexiconVersion };

// --- §4 primitives ---

export type EngineRulesVersion = typeof ENGINE_RULES_VERSION;

/** 64-bit seed as exactly 16 lowercase hex chars, `^[0-9a-f]{16}$` (ADR-0013 §D1). */
export type SeedHex = string & { readonly __brand: 'SeedHex' };
/** First 16 lowercase hex chars of SHA-256 over the JCS of `serializeState` (ADR-0013 §D3). */
export type StateHash = string & { readonly __brand: 'StateHash' };

/** Seat index in `[0, config.seats)`. Seat 0 is dealt first (R-BAG-005); `firstSeat` moves first (R-CORE-004). */
export type Seat = number;
/** Who an observation or event view is for. A spectator sees no rack at all. */
export type Viewer = Seat | 'spectator';

export type Letter =
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'H'
  | 'I'
  | 'J'
  | 'K'
  | 'L'
  | 'M'
  | 'N'
  | 'O'
  | 'P'
  | 'Q'
  | 'R'
  | 'S'
  | 'T'
  | 'U'
  | 'V'
  | 'W'
  | 'X'
  | 'Y'
  | 'Z';
/** A tile on a rack or in the bag: a letter, or `?` = undesignated blank. */
export type RackTile = Letter | '?';
/** A tile on the board: a letter tile, or a blank designated as that letter (lowercase, R-BAG-006). */
export type BoardTile = Letter | Lowercase<Letter>;

/** 0-based coordinates; row 0 = top, col 0 = left; never rotated per seat (GAME_RULES §2.1). */
export interface Square {
  readonly row: number;
  readonly col: number;
}
export type Direction = 'row' | 'col';

/**
 * A multiset of rack tiles as one string sorted ascending by UTF-16 code unit (`?` < `A` … `Z`).
 * A rack has no order: the player's arrangement is presentation state, kept by the app.
 */
export type TileString = string;

/**
 * One row of the board: exactly `layout.size` chars, `.` = empty, otherwise a `BoardTile`.
 * `board[row][col]` reads a square.
 */
export type BoardRow = string;

// --- §4.1 rules constants ---

export type LayoutId = 'classic-v1';
export type LetterTableId = 'letters-v1';
export type SquareKind = 'plain' | 'DL' | 'TL' | 'DW' | 'TW';

/** Premium layout. `classic-v1` equals GAME_RULES §2.1 square by square (snapshot test, P-BOARD-002-d). */
export interface Layout {
  readonly id: LayoutId;
  readonly size: 15;
  /** (7,7) for classic-v1; carries a DW (R-BOARD-004). */
  readonly start: Square;
  /** Row-major, length size × size. No tech squares in classic-v1 (R-BOARD-003 off). */
  readonly squares: readonly SquareKind[];
}

/** Letter table. `letters-v1` equals GAME_RULES §3.1 (GC-BAG-02). Index = LetterCode (0 = 'A'). */
export interface LetterTable {
  readonly id: LetterTableId;
  /** 26 entries. */
  readonly values: readonly number[];
  /** 26 entries, Σ = 98. */
  readonly counts: readonly number[];
  readonly blanks: 2;
  readonly blankValue: 0;
}

/** Every other outcome-affecting constant of rules version 1 (GAME_RULES v0.3). */
export interface Rules {
  /** R-BAG-003 */
  readonly rackSize: 7;
  /** R-BOARD-004 */
  readonly minFirstMoveTiles: 2;
  /** R-TURN-001 */
  readonly minBagForExchange: 7;
  /** R-TURN-004 (limit = 3 × active seats, GAME_RULES v0.3.1) */
  readonly scorelessTurnsPerSeat: 3;
  /** R-SCORE-004 */
  readonly fullStackTiles: 7;
  /** R-SCORE-004 */
  readonly fullStackBonus: 50;
  /** R-SCORE-003: novice 0, intermediate 4, advanced 8, expert 16. */
  readonly termBonus: Readonly<Record<Difficulty, number>>;
  /** R-SCORE-005: bonus = 5 × k */
  readonly chainStep: 5;
  /** R-SCORE-005: k ≤ 5 */
  readonly chainCap: 5;
}

// --- §5 lexicon dependency ---

/**
 * The part of LexiconIndex the engine uses:
 * - `lookup` / `lookupCodes`  → FormRef | undefined   (R-CORE-003; codes are LetterCode 0..25)
 * - `termOf(form: FormRef)`   → TermRef               (R-CORE-006: canonical term of a played form)
 * - `meta(term).id`, `meta(term).form`               (canonical term id and canonical form, for breakdowns)
 * - `difficulty(term)`                               (R-SCORE-003)
 * - `related(a, b)`  → RelationMask, 0 = unrelated   (R-SCORE-005, undirected, in-profile only)
 * - `version`, `profile.id`, `profile.definitionHash` (pinning; LEXICON_MISMATCH)
 */
export type EngineLexicon = Pick<
  LexiconIndex,
  'version' | 'profile' | 'lookup' | 'lookupCodes' | 'termOf' | 'meta' | 'difficulty' | 'related'
>;

/**
 * Injected per call; never stored in state. The engine never reads a clock, an RNG source or the environment:
 * the only randomness is the seed already inside the state.
 */
export interface EngineContext {
  readonly lexicon: EngineLexicon;
}

// --- §6 MatchConfig (= action-log header) ---

/** Everything `createMatch` needs, and exactly the `header` of an action log (ADR-0013 §D2). */
export interface MatchConfig {
  readonly seed: SeedHex;
  readonly engineRulesVersion: EngineRulesVersion;
  /** Pinned lexicon (R-CORE-001); compared with ctx.lexicon.version. */
  readonly lexiconVersion: LexiconVersion;
  /** Lexicon profile id, e.g. 'global-ranked' (R-CORE-001 "lexiconProfile"). */
  readonly profileId: string;
  /** 16 hex; canonical profile definition hash (lexicon-index note §4.2). */
  readonly definitionHash: string;
  /** Log key `config` kept from ADR-0013 §D2. */
  readonly config: MatchSetup;
}

/** Game setup. Only the listed values are valid in engineRulesVersion 1; anything else → INVALID_CONFIG. */
export interface MatchSetup {
  readonly mode: 'classic';
  /** 'untimed-vs-bot' (R-MODE-CLASSIC-002): seats = 2. 'untimed': 2–4 seats, no clock. Neither is competitive. */
  readonly format: 'untimed-vs-bot' | 'untimed';
  /** Number of seats, 2–4 (R-CORE-001). */
  readonly seats: number;
  /**
   * Partition of seats into teams, canonical form only:
   * 1v1 [[0],[1]]; 2v2 [[0,2],[1,3]] (alternating, R-CORE-004); FFA [[0],[1],[2]] or [[0],[1],[2],[3]].
   * Team index = position in this array; results and team scores are indexed by it.
   */
  readonly teams: readonly (readonly Seat[])[];
  readonly layout: LayoutId;
  readonly letters: LetterTableId;
  /** 1 = a single winner is mandatory (R-END-003 tie-break); 0 = equal scores draw. Integer, not boolean (API-3). */
  readonly requireWinner: 0 | 1;
}

// --- §7 MatchState (the hashed document) ---

/**
 * Complete, serialisable, immutable match state. EVERY field is part of the state hash (API-2):
 * `stateHash(s) = hex(SHA-256(UTF-8(JCS(s))))[0..16)`. Adding, removing, renaming or re-encoding any field,
 * or changing how any value evolves, requires an engineRulesVersion bump.
 * Consumers treat it as opaque except through observe(); the engine never mutates a state it was given.
 */
export interface MatchState {
  // --- identity (ADR-0013 §D3) ---
  readonly engineRulesVersion: EngineRulesVersion;
  /** Secret until the match ends (ADR-0013 §D9); never in an Observation. */
  readonly seed: SeedHex;
  readonly lexiconVersion: LexiconVersion;
  readonly profileId: string;
  readonly definitionHash: string;
  readonly config: MatchSetup;

  // --- turn ---
  /** Drawn once from the 'first-player' stream (R-CORE-004). */
  readonly firstSeat: Seat;
  readonly status: 'in_progress' | 'finished';
  /** Seat expected to act. Not advanced by the action that finishes the match. */
  readonly seatOnTurn: Seat;
  /** Accepted turn-ending actions so far (PLACE_WORD, EXCHANGE, PASS). RESIGN is not a turn. */
  readonly turnNumber: number;
  /** Consecutive scoreless turns, shared across seats (R-TURN-004). Reset by any accepted PLACE_WORD. */
  readonly scorelessTurns: number;
  /** Accepted actions so far = action-log length; `n` of the bot stream `bot:<seat>:<n>` (ADR-0013 §D1). */
  readonly actionCount: number;

  // --- tiles ---
  /** layout.size row strings (API-4). Premiums are layout constants, not stored. */
  readonly board: readonly BoardRow[];
  /** Remaining tiles in draw order; index 0 is drawn next (R-BAG-005). */
  readonly bag: TileString;
  /** xoshiro128** state of the 'bag' stream after the last shuffle: four u32 integers. */
  readonly rng: { readonly bag: readonly [number, number, number, number] };

  // --- per seat (index = Seat) ---
  readonly seats: readonly SeatState[];

  /** Present iff status === 'finished'. */
  readonly result?: MatchResult;
}

export interface SeatState {
  /** Sorted multiset (TileString). Kept for resigned FFA seats as the "retired rack" (R-END-002, R-BAG-004). */
  readonly rack: TileString;
  /** Running score incl. end-of-match adjustments (R-SCORE-006); may be negative after them. */
  readonly score: number;
  /** Chain length k ∈ [0, 5] (R-SCORE-005 b). */
  readonly chainK: number;
  /** This seat's previous main word as its played FORM (uppercase), "" if none (ADR-0013 Q-G3, R-CORE-006 c). */
  readonly lastMainForm: string;
  /** Best single-turn score (R-END-003 tie-break). */
  readonly bestTurnScore: number;
  /** v1 produces only 'active' and 'resigned'; 'forfeited' (Blitz) and 'eliminated' (Arena) are reserved. */
  readonly status: 'active' | 'resigned' | 'forfeited' | 'eliminated';
}

// --- §8 actions, rejections, engine errors ---

/** A placed tile. A lowercase `tile` places a blank from the rack designated as that letter (R-BAG-006). */
export interface Placement {
  readonly row: number;
  readonly col: number;
  readonly tile: BoardTile;
}

export interface PlaceWordAction {
  readonly seat: Seat;
  readonly type: 'PLACE_WORD';
  /** 1–7 tiles. Canonical form: sorted by (row, col) ascending, no duplicate squares. */
  readonly tiles: readonly Placement[];
}
export interface ExchangeAction {
  readonly seat: Seat;
  readonly type: 'EXCHANGE';
  /** 1–7 rack tiles, one char each ('?' = blank). Canonical form: sorted ascending by code unit. */
  readonly tiles: readonly RackTile[];
}
export interface PassAction {
  readonly seat: Seat;
  readonly type: 'PASS';
}
export interface ResignAction {
  readonly seat: Seat;
  readonly type: 'RESIGN';
}

/** engineRulesVersion 1 action set (ADR-0013 §D2). 'USE_POWER' and 'TIMEOUT' and the field `at` are reserved. */
export type Action = PlaceWordAction | ExchangeAction | PassAction | ResignAction;
export type ActionType = Action['type'];

export type PlacementViolation =
  /** 0 or > 7 tiles (R-TURN-002) */
  | 'tile_count'
  /** coordinate outside the layout (R-BOARD-001, P-BOARD-001-b) */
  | 'off_board'
  /** two tiles on one square (R-TURN-002) */
  | 'duplicate_square'
  /** square already holds a tile (R-TURN-002) */
  | 'occupied'
  /** not on one row or one column (R-TURN-002) */
  | 'not_collinear'
  /** empty square between first and last tile (R-TURN-002) */
  | 'gap'
  /** first move misses the start square (R-TURN-002, R-BOARD-004) */
  | 'start_not_covered'
  /** first move with 1 tile (R-BOARD-004) */
  | 'first_move_too_short'
  /** later move touches no existing tile (R-TURN-002, implies R-TURN-006 c) */
  | 'not_connected';

export type MalformedViolation =
  | 'unknown_type'
  | 'unknown_field'
  | 'seat_out_of_range'
  /** not a safe integer */
  | 'bad_coordinate'
  /** not a BoardTile / RackTile char */
  | 'bad_tile'
  /** '?' in a PLACE_WORD (R-BAG-006 a) */
  | 'blank_undesignated';

interface RejectionBase {
  readonly kind: 'rejection';
  readonly message: string;
}

/**
 * Codes are the rule-text reasons (R-TURN-003, P-GLOBAL-08) plus 'exchange' and 'malformed'.
 * `message` is developer English for logs/tests; UIs map `code`/`details` to i18n keys.
 */
export type Rejection =
  | (RejectionBase & { readonly code: 'match_over' })
  | (RejectionBase & {
      readonly code: 'malformed';
      readonly details: { readonly violation: MalformedViolation; readonly field: string };
    })
  | (RejectionBase & {
      readonly code: 'not_your_turn';
      readonly details: { readonly seatOnTurn: Seat; readonly seatInactive: boolean };
    })
  | (RejectionBase & {
      readonly code: 'rack';
      /** Tiles not available, sorted. */
      readonly details: { readonly missing: TileString };
    })
  | (RejectionBase & {
      readonly code: 'placement';
      readonly details: { readonly violation: PlacementViolation };
    })
  | (RejectionBase & {
      readonly code: 'not_in_lexicon';
      /** Exactly the non-playable formed words, in breakdown order (main first). */
      readonly details: {
        readonly words: readonly { readonly form: string; readonly main: boolean }[];
      };
    })
  | (RejectionBase & {
      readonly code: 'exchange';
      readonly details: { readonly violation: 'tile_count' | 'bag_too_small' };
    });

export type RejectionCode = Rejection['code'];

export type EngineErrorCode =
  /** state/config/log engineRulesVersion ≠ ENGINE_RULES_VERSION (ADR-0013 §D6) */
  | 'RULES_VERSION_UNSUPPORTED'
  /** ctx.lexicon identity ≠ match identity (ADR-0013 Q-G1) */
  | 'LEXICON_MISMATCH'
  /** createMatch: config outside §6 */
  | 'INVALID_CONFIG'
  /** parseState: not a valid MatchState document */
  | 'MALFORMED_STATE';

export interface EngineError {
  readonly kind: 'engine';
  readonly code: EngineErrorCode;
  readonly message: string;
  /** e.g. { field: 'config.teams' } or { expected: '<version>/<profile>/<hash>', actual: '…' }. */
  readonly details?: Readonly<Record<string, string | number>>;
}

export type ApplyFailure = Rejection | EngineError;

// --- §9 events ---

export type MatchEvent =
  | { readonly type: 'MATCH_STARTED'; readonly firstSeat: Seat; readonly bagCount: number }
  /** Private: `tiles` is present only in the full event and in the drawing seat's view. */
  | {
      readonly type: 'TILES_DRAWN';
      readonly seat: Seat;
      readonly cause: 'deal' | 'refill' | 'exchange';
      readonly count: number;
      readonly tiles?: TileString;
      readonly bagCount: number;
    }
  | {
      readonly type: 'WORD_PLACED';
      readonly seat: Seat;
      readonly tiles: readonly Placement[];
      readonly breakdown: ScoreBreakdown;
      readonly seatScore: number;
    }
  /** Private: `returned` is present only in the full event and in the exchanging seat's view. */
  | {
      readonly type: 'TILES_EXCHANGED';
      readonly seat: Seat;
      readonly count: number;
      readonly returned?: TileString;
    }
  | { readonly type: 'PASSED'; readonly seat: Seat; readonly scorelessTurns: number }
  | { readonly type: 'RESIGNED'; readonly seat: Seat }
  | { readonly type: 'TURN_STARTED'; readonly seat: Seat; readonly turnNumber: number }
  /** Final racks are public once the match is over, retired racks included (R-END-003, v0.3.1). */
  | {
      readonly type: 'MATCH_ENDED';
      readonly result: MatchResult;
      readonly finalRacks: readonly TileString[];
    };

export type MatchEventType = MatchEvent['type'];

// --- §10 observation ---

/**
 * What one viewer may know. Contains NO seed, NO RNG state, NO bag order, NO other seat's rack contents
 * (only counts). It is the only input of bots (`chooseAction(observation, ctx)`), of `evaluateMove` and of
 * `previewScore`, and what the app renders. Not hashed; a plain JSON-safe object.
 */
export interface Observation {
  readonly engineRulesVersion: EngineRulesVersion;
  readonly lexiconVersion: LexiconVersion;
  readonly profileId: string;
  readonly definitionHash: string;
  readonly config: MatchSetup;
  readonly viewer: Viewer;

  readonly status: 'in_progress' | 'finished';
  readonly firstSeat: Seat;
  readonly seatOnTurn: Seat;
  readonly turnNumber: number;
  readonly scorelessTurns: number;
  readonly actionCount: number;

  readonly board: readonly BoardRow[];
  readonly bagCount: number;
  /** The viewer's own rack (sorted); "" for a spectator. */
  readonly rack: TileString;
  /**
   * Tiles the viewer cannot see (bag + every other rack), as counts: index 0..25 = 'A'..'Z', 26 = blank.
   * Derived from public information only (initial bag − board − own rack). E-1.5 AC-8 "unseen-tile counts".
   */
  readonly unseen: readonly number[];
  readonly seats: readonly SeatView[];
  /** Index = team index in config.teams; Σ of member scores. */
  readonly teamScores: readonly number[];

  readonly result?: MatchResult;
  /** Present iff finished: every seat's final rack (public at the end, R-END-003 v0.3.1). */
  readonly finalRacks?: readonly TileString[];
}

export interface SeatView {
  readonly seat: Seat;
  readonly team: number;
  readonly rackCount: number;
  readonly score: number;
  readonly chainK: number;
  readonly lastMainForm: string;
  readonly bestTurnScore: number;
  readonly status: SeatState['status'];
}

// --- §11 scoring ---

export interface WordScore {
  /** As read on the board, uppercase (blanks shown as their designated letter). */
  readonly form: string;
  /** Canonical term (R-CORE-006): stable id and canonical form (PODS → 'pod' / 'POD'). E-1.7 AC-9. */
  readonly termId: string;
  readonly canonicalForm: string;
  readonly difficulty: Difficulty;
  /** True for the main word (R-TURN-006); exactly one per breakdown. */
  readonly main: boolean;
  readonly start: Square;
  readonly direction: Direction;
  /** Σ letterValue × letterMult over the word; letter multipliers only on newly covered squares; blanks 0. */
  readonly letterSum: number;
  /** Π word multipliers of newly covered squares (R-SCORE-001). */
  readonly wordMult: number;
  /** letterSum × wordMult (R-SCORE-008 step 1). */
  readonly base: number;
  /** Step 2, main word only: ⌊base / 2⌋ on a matching tech square. Always 0 in engineRulesVersion 1. */
  readonly techBonus: number;
  /** Step 3 delta, main word only (Compile). Always 0 in engineRulesVersion 1. */
  readonly compileBonus: number;
  /** Step 4: bonus of the canonical term's difficulty, never multiplied (R-SCORE-003). */
  readonly termBonus: number;
  /** base + techBonus + compileBonus + termBonus. */
  readonly total: number;
}

/** R-SCORE-008 breakdown of one accepted (or evaluated) PLACE_WORD; clients render it verbatim. */
export interface ScoreBreakdown {
  /** Main word first, then cross-words ordered by the (row, col) of their newly placed tile. */
  readonly words: readonly WordScore[];
  readonly tilesPlaced: number;
  /** 50 iff tilesPlaced === 7 (R-SCORE-004), else 0. */
  readonly fullStack: number;
  /** 5 × chainKAfter if the main word linked, else 0 (R-SCORE-005). */
  readonly chain: number;
  /** The mover's k after this move: k+1 capped at 5 on a link, 0 otherwise (R-SCORE-005 b, c, f). */
  readonly chainKAfter: number;
  /** Σ words[].total + fullStack + chain. Integer ≥ 0 (P-GLOBAL-06). */
  readonly total: number;
}

/** Lexicon-free projection (R-SCORE-009): premiums and Full Stack only; never reveals validity. */
export interface PreviewScore {
  readonly words: readonly {
    readonly form: string;
    readonly main: boolean;
    readonly start: Square;
    readonly direction: Direction;
    readonly letterSum: number;
    readonly wordMult: number;
    readonly base: number;
  }[];
  readonly fullStack: number;
  /** Σ base + fullStack (P-SCORE-009-b). */
  readonly total: number;
}

/** evaluateMove output for bots. */
export interface MoveEvaluation {
  /** The canonical form of the evaluated action. */
  readonly action: PlaceWordAction;
  /** Identical to the WORD_PLACED breakdown apply would produce (P-API-01). */
  readonly breakdown: ScoreBreakdown;
  /** Rack after placing, before refill (sorted). */
  readonly leave: TileString;
  /** True if this move empties the rack while the bag is empty, ending the match (R-END-001). */
  readonly goesOut: boolean;
}

// --- §12 result ---

export type MatchEnd =
  /** R-END-001 */
  | { readonly reason: 'going_out'; readonly seat: Seat }
  /** R-TURN-004 */
  | { readonly reason: 'scoreless_turns' }
  /** R-END-002: the resignation that ended it */
  | { readonly reason: 'resign'; readonly seat: Seat };

/** Part of the hashed state once finished (API-3: integers and strings only). */
export interface MatchResult {
  readonly end: MatchEnd;
  /** Per seat, R-SCORE-006 adjustments (all 0 on resign). Already included in seats[i].score. */
  readonly adjustments: readonly number[];
  /** Per team (config.teams index): Σ member scores after adjustments. */
  readonly teamScores: readonly number[];
  /**
   * Per team: 1-based place, ties share a place ("1224" ranking). Exactly one team at place 1 = a win;
   * several = a draw (R-END-003). Resigned teams rank below every active team and share that place
   * (R-END-002 v0.3.1).
   */
  readonly places: readonly number[];
  /** How place 1 was decided (R-END-003). */
  readonly decidedBy: 'score' | 'resign' | 'tiebreak_best_turn' | 'tiebreak_second_mover';
}
