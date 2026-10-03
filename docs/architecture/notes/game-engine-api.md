# Design note — `@codelex/game-engine` public API (`engineRulesVersion` 1)

- Status: Proposed · Date: 2026-10-02 · Owner/author: game-engine-engineer (decisions delegated by the product owner)
- Reviewed-by: pending solution-architect, ai-engineer
- Sprint: `docs/sprints/2026-10-02-phase1-engine-core.md` — D4 (this note). Unblocks E2–E4 (engine), L2 (lexicon
  index types), B1 (bots), and the E-1.5 mobile work next sprint.
- Inputs (normative, this note never overrides them): `docs/adr/0013-determinism-replay-contract.md` (ADR-0013),
  `docs/game/GAME_RULES.md` v0.3 (= `engineRulesVersion` 1), `docs/game/RULE_PROPERTIES.md`,
  `docs/architecture/notes/lexicon-index.md`, `docs/specs/E-1.7-playtest-lexicon/playtest-lexicon.md`,
  `packages/config/README.md`, `docs/standards/ENGINEERING.md`.

This note fixes the **names and shapes** that ADR-0013 left to D4: the `MatchConfig` carried in the log header, the
field names of the hashed `MatchState` document, the replay outcome codes, and every type a consumer needs. The
TypeScript blocks are the contract; E1–E4 implement them verbatim (doc comments included). Everything not hashed
(events, observation, breakdown, rejection details) is a two-way door governed by package semver until
`packages/protocol` wraps it in Phase 2. Everything hashed is frozen by the GC-DET-01 golden hash under
`engineRulesVersion` 1 (ADR-0013 §D3, §D5).

## 1. Scope

**In the engine:** match creation, rules validation, scoring with breakdown, end-of-match, per-seat observation,
score preview, candidate-move evaluation for bots, state serialisation and hash, action-log parse/serialise, replay,
seeded RNG (`./rng`).

**Explicitly not in the engine** (and why):

| Not in the engine | Lives in | Reason |
|---|---|---|
| Move generation (`legalMoves`, anchors, cross-check masks, candidate ranking) | `packages/bots` (`chooseAction(observation, ctx)`), using the GADDAG of `@codelex/lexicon/index` | Sprint decision; keeps the engine small and the hot path free of search. Bots score candidates only through `evaluateMove` (CLAUDE.md §1.2). |
| Timers, clocks, deadlines, think delays, latency compensation | `services/game` (Phase 2), `apps/mobile` (presentation) | No clock exists in `engineRulesVersion` 1 (only untimed formats). Timed formats arrive with `TIMEOUT` and the `at` field in a later rules version (ADR-0013 §D2). |
| IO of any kind: loading/decoding the lexicon index, persistence, network, logging, analytics | callers | Purity (ADR-0013 §D4, config purity lint). The index is injected as `ctx.lexicon`. |
| Seed generation | server CSPRNG / device `crypto.getRandomValues` | ADR-0013 §D1; the engine only consumes a seed. |
| Seat → player mapping, `competitive` flag, ranked/Daily eligibility, `seq`/idempotency keys | `services/game`, `apps/mobile` | No PII in logs (ADR-0013 §D2); server command handling is a service concern. |
| User-facing text | `packages/i18n` | Rejections carry codes; `message` is developer English, never displayed. |
| Knowledge Card content, XP | lexicon cards artefact, `services/progression` | Not on the engine path; the engine exposes `termId` per scored word. |
| Undo, hints, AI Assist, powers, Arena, Blitz, Daily | later epics / rules versions | Out of Phase 1; `USE_POWER` and `TIMEOUT` are reserved names (ADR-0013 §D2). |

## 2. Decisions (recorded under product-owner delegation; all reversible until the first published replay)

| ID | Decision | Rationale |
|---|---|---|
| API-1 | `MatchConfig` **is** the log header: `{ seed, engineRulesVersion, lexiconVersion, profileId, definitionHash, config: MatchSetup }`. The ADR's `header.config` object is named `MatchSetup`. | One type for "what creates a match" and "what a log pins"; no mapping code; the ADR's JSON keys are kept unchanged. |
| API-2 | `MatchState` **is** the hashed document: every field is hashed, nothing else is stored in it. No caches, no presentation fields. | ADR-0013 §D3 "everything that determines future behaviour or the result, and nothing else" becomes a type-level rule: adding a field to `MatchState` = `engineRulesVersion` bump, visibly. |
| API-3 | Hashed and logged data uses only objects, arrays, ASCII strings and safe integers: no booleans, no `null`, no floats. Flags are `0 \| 1`; absent optional fields are omitted (`exactOptionalPropertyTypes`), never `undefined`. | JCS subset of ADR-0013 §D3 and log rules of §D2. Non-hashed outputs (events, breakdown, rejection) may use booleans. |
| API-4 | Board = 15 row strings (`.` empty), racks and bag = strings in the ADR-0013 tile encoding. | ADR-0013 §D3; strings are immutable (purity for free), compact, diffable, and cheap to structurally share between states. |
| API-5 | `apply` fails with `Rejection` (player-level, rule-cited, lowercase codes from R-TURN-003) **or** `EngineError` (system-level, UPPER_SNAKE codes from ADR-0013), discriminated by `kind`. | ADR-0013 Q-G1: `LEXICON_MISMATCH` is an engine error, not a rejection. Lowercase rejection codes equal the rule text and the E-1.5 `word_rejected.reason` values. |
| API-6 | `evaluateMove` takes an **`Observation`**, not a `MatchState`. | Bots only ever hold an observation (P-GLOBAL-07, E-1.5 AC-8); passing the state would hand them the bag order and the seed. Everything scoring needs (board, own rack, own chain, layout) is in the observation. Server code calls `evaluateMove(observe(state, seat), …)`. |
| API-7 | `previewScore(observation, tiles)` has **no `ctx` parameter**. | R-SCORE-009 / P-SCORE-009-a: the preview cannot consult the lexicon by construction, not by discipline. |
| API-8 | The engine depends on a **subset** of `LexiconIndex` (`EngineLexicon`, a `Pick<>`), including the `FormRef`/`TermRef` split of E-1.7. | Minimal surface for fakes and spies in tests; L2 must provide these members (§5). |
| API-9 | Formats in v1: `untimed-vs-bot` (exactly 2 seats) and `untimed` (2–4 seats: simulator, 2v2/FFA tests, hot-seat). | Both are clock-free. Adding a format later is an outcome change (ADR-0013 §D5), so the second one is included now; neither is competitive. |
| API-10 | Engine-wide **rejection precedence** is fixed (§8.3) so the same invalid action always yields the same code. | Determinism of outputs (tests, analytics), even though rejections are not logged. |
| API-11 | Rules ambiguities found while fixing shapes get a **default reading** implemented and tagged `@ambiguous` until `game-designer` decides (§16). | Agent rule "never guess silently"; RULE_PROPERTIES §6 convention. |

## 3. Package, export map, dependencies

```jsonc
// packages/game-engine/package.json (shape; E1 scaffolds it with /scaffold, strict preset)
{
  "name": "@codelex/game-engine",
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".":     { "types": "./dist/index.d.ts",     "default": "./dist/index.js" },
    "./rng": { "types": "./dist/rng/index.d.ts", "default": "./dist/rng/index.js" }
  },
  "dependencies": {
    "@codelex/config":  "workspace:*",   // runtime: ./result only
    "@codelex/lexicon": "workspace:*"    // `import type` only from ./index (erased at runtime)
  }
}
```

- Two entries only. `.` = everything in §4–§13; `./rng` = §14 (bots and tests import it without the rules code).
  No `./internal`, no `./testing`: fixture states for golden cases are built inside the engine's own tests; bots and
  mobile build fixture **observations** directly (plain objects).
- Source layout (internal, may change): `src/{board,bag,placement,validation,scoring,modes/classic,replay,rng,hash}/`.
  Hashing (SHA-256, JCS subset) is internal; it is not exported.
- Imports allowed by lint (`codelex/pure-imports`): relative, `@codelex/lexicon` (types), `@codelex/config/result`.
  No zod: input shape checks are hand-written (§8.2, §13.7).

## 4. Primitive types

```ts
import type { Result } from '@codelex/config/result';
import type { Difficulty, LexiconIndex, LexiconVersion } from '@codelex/lexicon/index';

/** The single rules version this build implements (ADR-0013 §D5). */
export const ENGINE_RULES_VERSION = 1;
export type EngineRulesVersion = typeof ENGINE_RULES_VERSION;
/** Action-log envelope version this build writes (ADR-0013 §D2). */
export const LOG_VERSION = 1;

/** 64-bit seed as exactly 16 lowercase hex chars, `^[0-9a-f]{16}$` (ADR-0013 §D1). */
export type SeedHex = string & { readonly __brand: 'SeedHex' };
/** First 16 lowercase hex chars of SHA-256 over the JCS of `serializeState` (ADR-0013 §D3). */
export type StateHash = string & { readonly __brand: 'StateHash' };

/** Seat index in `[0, config.seats)`. Seat 0 is dealt first (R-BAG-005); `firstSeat` moves first (R-CORE-004). */
export type Seat = number;
/** Who an observation or event view is for. A spectator sees no rack at all. */
export type Viewer = Seat | 'spectator';

export type Letter =
  | 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M'
  | 'N' | 'O' | 'P' | 'Q' | 'R' | 'S' | 'T' | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z';
/** A tile on a rack or in the bag: a letter, or `?` = undesignated blank. */
export type RackTile = Letter | '?';
/** A tile on the board: a letter tile, or a blank designated as that letter (lowercase, R-BAG-006). */
export type BoardTile = Letter | Lowercase<Letter>;

/** 0-based coordinates; row 0 = top, col 0 = left; never rotated per seat (GAME_RULES §2.1). */
export interface Square { readonly row: number; readonly col: number }
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
```

### 4.1 Rules constants (frozen for `engineRulesVersion` 1)

```ts
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
  readonly values: readonly number[];   // 26 entries
  readonly counts: readonly number[];   // 26 entries, Σ = 98
  readonly blanks: 2;
  readonly blankValue: 0;
}

export function getLayout(id: LayoutId): Layout;
export function getLetterTable(id: LetterTableId): LetterTable;

/** Every other outcome-affecting constant of rules version 1 (GAME_RULES v0.3). */
export const RULES: {
  readonly rackSize: 7;                    // R-BAG-003
  readonly minFirstMoveTiles: 2;           // R-BOARD-004
  readonly minBagForExchange: 7;           // R-TURN-001
  readonly scorelessTurnsPerSeat: 3;       // R-TURN-004 (limit = 3 × seats, see §16 Q-GD-1)
  readonly fullStackTiles: 7;              // R-SCORE-004
  readonly fullStackBonus: 50;             // R-SCORE-004
  readonly termBonus: Readonly<Record<Difficulty, number>>;  // novice 0, intermediate 4, advanced 8, expert 16
  readonly chainStep: 5;                   // R-SCORE-005: bonus = 5 × k
  readonly chainCap: 5;                    // R-SCORE-005: k ≤ 5
};
```

## 5. Lexicon dependency and context

The engine imports **types only** from `@codelex/lexicon/index` (task L2) and receives the instance in the context.
It relies on the E-1.7 split (AC-8): a `FormRef` identifies a playable string (canonical form or declared
inflection); a `TermRef` identifies the canonical term holding metadata and relations.

```ts
/**
 * The part of LexiconIndex the engine uses. L2 must export these members with these meanings:
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
```

- **Pinning check.** `createMatch`, `apply`, `evaluateMove` and `replay` compare (`lexicon.version`,
  `lexicon.profile.id`, `lexicon.profile.definitionHash`) with the match (`lexiconVersion`, `profileId`,
  `definitionHash`) and return `EngineError` `LEXICON_MISMATCH` on any difference (ADR-0013 Q-G1). Cost: three string
  compares per call.
- **`TermRef`/`FormRef` are never persisted** (lexicon-index note §2.2): state stores forms; breakdowns expose
  `termId` (stable string id) and forms.
- If L2 chooses different member names, L2 updates this section in its PR; semantics must not change.

## 6. `MatchConfig` (= action-log header)

```ts
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
  readonly layout: LayoutId;          // 'classic-v1'
  readonly letters: LetterTableId;    // 'letters-v1'
  /** 1 = a single winner is mandatory (R-END-003 tie-break); 0 = equal scores draw. Integer, not boolean (API-3). */
  readonly requireWinner: 0 | 1;
}
```

Example header (ADR-0013 §D2, extended with the D4 `config` fields):

```json
{
  "seed": "00c0de1e00000001", "engineRulesVersion": 1,
  "lexiconVersion": "<16 hex>", "profileId": "global-ranked", "definitionHash": "<16 hex>",
  "config": { "mode": "classic", "format": "untimed-vs-bot", "seats": 2, "teams": [[0], [1]],
              "layout": "classic-v1", "letters": "letters-v1", "requireWinner": 0 }
}
```

## 7. `MatchState` (the hashed document)

```ts
/**
 * Complete, serialisable, immutable match state. EVERY field is part of the state hash (API-2):
 * `stateHash(s) = hex(SHA-256(UTF-8(JCS(s))))[0..16)`. Adding, removing, renaming or re-encoding any field,
 * or changing how any value evolves, requires an engineRulesVersion bump (§15).
 * Consumers treat it as opaque except through observe(); the engine never mutates a state it was given.
 */
export interface MatchState {
  // --- identity (ADR-0013 §D3) ---
  readonly engineRulesVersion: EngineRulesVersion;
  readonly seed: SeedHex;                    // secret until the match ends (ADR-0013 §D9); never in an Observation
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
```

### 7.1 Hashed fields — mapping to ADR-0013 §D3

| ADR-0013 §D3 item | `MatchState` field(s) |
|---|---|
| identity | `engineRulesVersion`, `seed`, `lexiconVersion`, `profileId`, `definitionHash`, `config` |
| `firstSeat` | `firstSeat` |
| seat on turn, turn number, scoreless counter, accepted action count | `seatOnTurn`, `turnNumber`, `scorelessTurns`, `actionCount` |
| board | `board` |
| bag, `rng.bag` | `bag`, `rng.bag` |
| racks (incl. retired) | `seats[i].rack` |
| per seat: score, chain `k`, previous main word (form), best single turn, status | `seats[i].score`, `.chainK`, `.lastMainForm`, `.bestTurnScore`, `.status` |
| status; end reason and result | `status`, `result` (§12) |

Not in `MatchState` (ADR-0013 "Excluded"): the index, breakdowns, events, rejections, bot internals, presentation
state, derived caches (anchors, cross-checks, team scores, unseen counts), Knowledge-Card data, any clock reading.

### 7.2 Initial state (what `createMatch` computes)

1. Validate the config (§13.1). 2. `firstSeat = firstPlayerStream.int(0, seats)`. 3. Bag = `letters-v1` multiset in
ascending code-unit order (`??AAAAAAAAB…Z`), Fisher–Yates with the `bag` stream (ADR-0013 §D1). 4. Deal 7 tiles per
seat from the head, seat 0 first, one full rack at a time (R-BAG-005); racks sorted. 5. `rng.bag` = the stream state
after the shuffle. 6. `seatOnTurn = firstSeat`; counters 0; `status 'in_progress'`; seats `{score 0, chainK 0,
lastMainForm "", bestTurnScore 0, status 'active'}`; board all `.`.

Illustrative serialisation (values invented, JCS key order; the real GC-DET-01 hash is recorded by E4):

```json
{"actionCount":0,"bag":"<86 tiles>","board":["...............","…13 more…","..............."],
 "config":{"format":"untimed-vs-bot","layout":"classic-v1","letters":"letters-v1","mode":"classic",
 "requireWinner":0,"seats":2,"teams":[[0],[1]]},"definitionHash":"<16 hex>","engineRulesVersion":1,
 "firstSeat":1,"lexiconVersion":"<16 hex>","profileId":"global-ranked","rng":{"bag":[1,2,3,4]},
 "scorelessTurns":0,"seatOnTurn":1,"seats":[{"bestTurnScore":0,"chainK":0,"lastMainForm":"","rack":"?AEINST",
 "score":0,"status":"active"},{"bestTurnScore":0,"chainK":0,"lastMainForm":"","rack":"CDLOPRU","score":0,
 "status":"active"}],"seed":"00c0de1e00000001","status":"in_progress","turnNumber":0}
```

## 8. Actions, rejections, engine errors

### 8.1 `Action`

```ts
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
export interface PassAction { readonly seat: Seat; readonly type: 'PASS' }
export interface ResignAction { readonly seat: Seat; readonly type: 'RESIGN' }

/** engineRulesVersion 1 action set (ADR-0013 §D2). 'USE_POWER' and 'TIMEOUT' and the field `at` are reserved. */
export type Action = PlaceWordAction | ExchangeAction | PassAction | ResignAction;
export type ActionType = Action['type'];
```

- The JSON of an `Action` is exactly its log entry (ADR-0013 §D2). Clients send no score, validity, word or
  timer field (R-CORE-002 a): the type has none, and `apply` rejects unknown keys (`malformed`).
- `apply` accepts non-canonical input and returns the **canonical** action in its result; only that is logged.

### 8.2 `Rejection` (player-level, R-TURN-005: invisible, state unchanged)

```ts
export type PlacementViolation =
  | 'tile_count'            // 0 or > 7 tiles                                  R-TURN-002
  | 'off_board'             // coordinate outside the layout                   R-BOARD-001 (P-BOARD-001-b)
  | 'duplicate_square'      // two tiles on one square                         R-TURN-002
  | 'occupied'              // square already holds a tile                     R-TURN-002
  | 'not_collinear'         // not on one row or one column                    R-TURN-002
  | 'gap'                   // empty square between first and last tile        R-TURN-002
  | 'start_not_covered'     // first move misses the start square              R-TURN-002, R-BOARD-004
  | 'first_move_too_short'  // first move with 1 tile                          R-BOARD-004
  | 'not_connected';        // later move touches no existing tile             R-TURN-002 (implies R-TURN-006 c)

export type MalformedViolation =
  | 'unknown_type' | 'unknown_field' | 'seat_out_of_range'
  | 'bad_coordinate'        // not a safe integer
  | 'bad_tile'              // not a BoardTile / RackTile char
  | 'blank_undesignated';   // '?' in a PLACE_WORD (R-BAG-006 a)

interface RejectionBase { readonly kind: 'rejection'; readonly message: string }

/**
 * Codes are the rule-text reasons (R-TURN-003, P-GLOBAL-08) plus 'exchange' and 'malformed'.
 * `message` is developer English for logs/tests; UIs map `code`/`details` to i18n keys.
 */
export type Rejection =
  | (RejectionBase & { readonly code: 'match_over' })                                         // P-GLOBAL-08
  | (RejectionBase & { readonly code: 'malformed';
      readonly details: { readonly violation: MalformedViolation; readonly field: string } })
  | (RejectionBase & { readonly code: 'not_your_turn';                                        // R-TURN-001
      readonly details: { readonly seatOnTurn: Seat; readonly seatInactive: boolean } })
  | (RejectionBase & { readonly code: 'rack';                                                 // R-TURN-002, R-BAG-005 d
      readonly details: { readonly missing: TileString } })      // tiles not available, sorted
  | (RejectionBase & { readonly code: 'placement';                                            // R-TURN-002, R-BOARD-004
      readonly details: { readonly violation: PlacementViolation } })
  | (RejectionBase & { readonly code: 'not_in_lexicon';                                       // R-TURN-003
      /** Exactly the non-playable formed words, in breakdown order (main first). */
      readonly details: { readonly words: readonly { readonly form: string; readonly main: boolean }[] } })
  | (RejectionBase & { readonly code: 'exchange';                                             // R-TURN-001, R-BAG-005 d
      readonly details: { readonly violation: 'tile_count' | 'bag_too_small' } });

export type RejectionCode = Rejection['code'];
```

`code` → rule mapping: `placement` R-TURN-002/R-BOARD-001/R-BOARD-004/R-TURN-006 c; `not_in_lexicon` R-TURN-003 and
R-CORE-003; `rack` R-TURN-002 (multiset) and R-BAG-005 d; `not_your_turn` R-TURN-001; `exchange` R-TURN-001 and
R-BAG-005 d; `match_over` P-GLOBAL-08; `malformed` R-TURN-001 a (schema). `timeout` (GC-TURN-07) is reserved for the
rules version that adds clocks. E-1.5 analytics `word_rejected.reason = cross_word` is derived by the app from
`not_in_lexicon` when no listed word has `main: true`.

### 8.3 Rejection precedence (API-10)

Checks run in this order; the first failure is returned:

1. engine errors: `RULES_VERSION_UNSUPPORTED` (state), `LEXICON_MISMATCH` (ctx);
2. `match_over` (any action, RESIGN included, once `status === 'finished'`);
3. `malformed` (shape, unknown keys, seat range, chars, integer coordinates);
4. `not_your_turn` — skipped for RESIGN from an active seat (R-END-002); a resigned seat gets `not_your_turn` with
   `seatInactive: true` for every action;
5. PLACE_WORD: `placement` `tile_count`, `off_board`, `duplicate_square` → `rack` → remaining `placement`
   checks in the order listed in `PlacementViolation` → `not_in_lexicon` (all formed words looked up, all failures
   listed);
   EXCHANGE: `exchange` `tile_count` → `exchange` `bag_too_small` → `rack`.

### 8.4 `EngineError` (system-level; never a player's fault)

```ts
export type EngineErrorCode =
  | 'RULES_VERSION_UNSUPPORTED'  // state/config/log engineRulesVersion ≠ ENGINE_RULES_VERSION (ADR-0013 §D6)
  | 'LEXICON_MISMATCH'           // ctx.lexicon identity ≠ match identity (ADR-0013 Q-G1)
  | 'INVALID_CONFIG'             // createMatch: config outside §6
  | 'MALFORMED_STATE';           // parseState: not a valid MatchState document

export interface EngineError {
  readonly kind: 'engine';
  readonly code: EngineErrorCode;
  readonly message: string;
  /** e.g. { field: 'config.teams' } or { expected: '<version>/<profile>/<hash>', actual: '…' }. */
  readonly details?: Readonly<Record<string, string | number>>;
}

export type ApplyFailure = Rejection | EngineError;
```

## 9. Events

Events are **outputs** (not hashed, not logged; ADR-0013 §D3). They describe exactly what changed, in order, with
full information; `eventsFor` produces each viewer's redacted copy. `services/game` maps them to
`match.started.v1` / `match.move_applied.v1` / `match.finished.v1` (Phase 2, `packages/protocol`); the app animates
from them.

```ts
export type MatchEvent =
  | { readonly type: 'MATCH_STARTED'; readonly firstSeat: Seat; readonly bagCount: number }
  /** Private: `tiles` is present only in the full event and in the drawing seat's view. */
  | { readonly type: 'TILES_DRAWN'; readonly seat: Seat; readonly cause: 'deal' | 'refill' | 'exchange';
      readonly count: number; readonly tiles?: TileString; readonly bagCount: number }
  | { readonly type: 'WORD_PLACED'; readonly seat: Seat; readonly tiles: readonly Placement[];
      readonly breakdown: ScoreBreakdown; readonly seatScore: number }
  /** Private: `returned` is present only in the full event and in the exchanging seat's view. */
  | { readonly type: 'TILES_EXCHANGED'; readonly seat: Seat; readonly count: number;
      readonly returned?: TileString }
  | { readonly type: 'PASSED'; readonly seat: Seat; readonly scorelessTurns: number }
  | { readonly type: 'RESIGNED'; readonly seat: Seat }
  | { readonly type: 'TURN_STARTED'; readonly seat: Seat; readonly turnNumber: number }
  /** Final racks are public once the match is over (R-SCORE-006 needs them; see §16 Q-GD-5). */
  | { readonly type: 'MATCH_ENDED'; readonly result: MatchResult; readonly finalRacks: readonly TileString[] };

export type MatchEventType = MatchEvent['type'];
```

Order per call: `createMatch` → `MATCH_STARTED`, `TILES_DRAWN(deal)` × seats (seat 0 first), `TURN_STARTED`.
`PLACE_WORD` → `WORD_PLACED`, `TILES_DRAWN(refill)` if ≥ 1 tile drawn, then `MATCH_ENDED` or `TURN_STARTED`.
`EXCHANGE` → `TILES_EXCHANGED`, `TILES_DRAWN(exchange)`, then `MATCH_ENDED` or `TURN_STARTED`. `PASS` → `PASSED`, then
`MATCH_ENDED` or `TURN_STARTED`. `RESIGN` → `RESIGNED`, then `MATCH_ENDED`, or (FFA, match continues) `TURN_STARTED`
if the resigner was on turn.

## 10. `Observation` (per viewer; P-GLOBAL-07)

```ts
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
  /** Present iff finished: every seat's final rack (public at the end, §16 Q-GD-5). */
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
```

## 11. Scoring types

`ScoreBreakdown` uses the RULE_PROPERTIES §3.1 golden field names (`form`, `main`, `letterSum`, `wordMult`, `base`,
`termBonus`, `fullStack`, `chain`, `chainKAfter`, `total`) so golden JSON transcribes into assertions 1:1, and
adds what R-SCORE-008 and E-1.7 AC-9 require.

```ts
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
    readonly form: string; readonly main: boolean; readonly start: Square; readonly direction: Direction;
    readonly letterSum: number; readonly wordMult: number; readonly base: number;
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
```

## 12. `MatchResult`

```ts
export type MatchEnd =
  | { readonly reason: 'going_out'; readonly seat: Seat }       // R-END-001
  | { readonly reason: 'scoreless_turns' }                      // R-TURN-004
  | { readonly reason: 'resign'; readonly seat: Seat };         // R-END-002: the resignation that ended it

/** Part of the hashed state once finished (API-3: integers and strings only). */
export interface MatchResult {
  readonly end: MatchEnd;
  /** Per seat, R-SCORE-006 adjustments (all 0 on resign). Already included in seats[i].score. */
  readonly adjustments: readonly number[];
  /** Per team (config.teams index): Σ member scores after adjustments. */
  readonly teamScores: readonly number[];
  /**
   * Per team: 1-based place, ties share a place ("1224" ranking). Exactly one team at place 1 = a win;
   * several = a draw (R-END-003). Resigned teams rank below every active team (§16 Q-GD-3).
   */
  readonly places: readonly number[];
  /** How place 1 was decided (R-END-003). */
  readonly decidedBy: 'score' | 'resign' | 'tiebreak_best_turn' | 'tiebreak_second_mover';
}
```

Golden mapping: GC-CL-E1 `seat0_wins` ↔ `places [1,2]`; GC-CL-E3 `draw` ↔ `places [1,1]`, `decidedBy 'score'`;
GC-CL-E4 `teamA_wins` ↔ `teamScores [313,277]`, `adjustments [-2,-5,15,-8]`; GC-CL-E5 ↔ `end {reason:'resign',
seat:0}`, `places [2,1]`, `decidedBy 'resign'`.

## 13. Functions

All functions are synchronous, pure and total over their declared types (§17). None throws for any value of its
parameter types except where "programmer error" is stated.

```ts
export interface Applied {
  readonly state: MatchState;
  readonly events: readonly MatchEvent[];
  /** Canonical action to append to the log (ADR-0013 §D2). */
  readonly action: Action;
}

/** §13.1 */
export function createMatch(
  config: MatchConfig, ctx: EngineContext,
): Result<{ readonly state: MatchState; readonly events: readonly MatchEvent[] }, EngineError>;

/** §13.2 */
export function apply(state: MatchState, action: Action, ctx: EngineContext): Result<Applied, ApplyFailure>;

/** §13.3 — never fails; a seat outside the match is a programmer error (throws). */
export function observe(state: MatchState, viewer: Viewer): Observation;

/** §13.3 — redacts private fields (TILES_DRAWN.tiles, TILES_EXCHANGED.returned) for other viewers. */
export function eventsFor(events: readonly MatchEvent[], viewer: Viewer): readonly MatchEvent[];

/** §13.4 — the bots' only scoring path. */
export function evaluateMove(
  observation: Observation, action: PlaceWordAction, ctx: EngineContext,
): Result<MoveEvaluation, ApplyFailure>;

/** §13.5 — R-SCORE-009; null when the placement fails geometry or the viewer's rack (P-SCORE-009-d). */
export function previewScore(observation: Observation, tiles: readonly Placement[]): PreviewScore | null;

/** §13.6 */
export function stateHash(state: MatchState): StateHash;
export function serializeState(state: MatchState): string;          // JCS text, the hashed bytes
export function parseState(text: string): Result<MatchState, EngineError>;

/** §14.2 */
export function newActionLog(config: MatchConfig): ActionLog;
export function serializeActionLog(log: ActionLog): string;         // JCS text
export function parseActionLog(text: string): Result<ActionLog, ReplayError>;
export function replay(
  log: ActionLog, ctx: EngineContext, options?: { readonly recordHashes?: boolean },
): Result<ReplayOutcome, ReplayError>;
```

### 13.1 `createMatch`
Checks, in order: `config.engineRulesVersion` (`RULES_VERSION_UNSUPPORTED`), shape and values of §6
(`INVALID_CONFIG`, `details.field`), `LEXICON_MISMATCH`. Then builds §7.2. Same config ⇒ deep-equal state
(P-CORE-001-c). The `ctx.lexicon` is used for the identity check only.

### 13.2 `apply`
- Precedence §8.3. On any failure, the returned error is the only output; the input state is untouched and still
  valid (P-GLOBAL-03, R-TURN-005). Rejections are free and unlimited in v1 (no counter in state).
- Canonicalises the action, then: PLACE_WORD per R-TURN-002/003/006, R-SCORE-001…008, R-BAG-003, R-END-001;
  EXCHANGE per R-BAG-005; PASS; RESIGN per R-END-002. Turn advance = next **active** seat in increasing index
  modulo `seats` (R-CORE-004 d).
- After a PLACE_WORD: `scorelessTurns = 0`, mover's `chainK`/`lastMainForm`/`bestTurnScore` updated (Pass, Exchange
  never touch the chain, R-SCORE-005 c). After PASS/EXCHANGE: `scorelessTurns + 1`, then the R-TURN-004 check.
- End of match: `status 'finished'`, `result` set, R-SCORE-006 applied for `going_out`/`scoreless_turns` only,
  `seatOnTurn` unchanged. Any further action → `match_over` (P-GLOBAL-08).
- Returns new objects for every changed path and shares unchanged ones (rows, seats) with the input.

### 13.3 `observe`, `eventsFor`
Pure projections. `observe(state, seat)` and `observe(state, 'spectator')`. Two states that differ only in hidden
information (other racks with equal counts, bag order, seed, `rng`) give deep-equal observations for the same viewer
(property P-API-03).

### 13.4 `evaluateMove` (bots, API-6)
- Same checks and arithmetic as `apply` for a PLACE_WORD by `observation.viewer`, using `observation.rack`, minus
  the turn check (bots may evaluate before their turn). A spectator viewer or `action.seat ≠ viewer` → `malformed`
  (`seat_out_of_range`). Finished observation → `match_over`. Lexicon identity is checked like `apply`.
- Contract **P-API-01**: for every reachable state `s` with seat `p` on turn and every PLACE_WORD `a` by `p`,
  `evaluateMove(observe(s, p), a, ctx)` is ok ⇔ `apply(s, a, ctx)` is ok, with the same rejection otherwise, and
  `breakdown` deep-equals the `WORD_PLACED.breakdown` of `apply`.
- No allocation of a new state; budget §18. Bots must not re-implement any part of scoring or validation.

### 13.5 `previewScore`
Geometric checks of R-TURN-002/R-BOARD-004 plus the viewer's rack; no `ctx`, so no lexicon (API-7). Returns `null`
on any failure. For an accepted move, `committed.total − preview.total = Σ termBonus + chain (+ tech + compile)`
(P-SCORE-009-c). Gating by `match.live_score_preview` is the app's job.

### 13.6 State serialisation and hash
`serializeState` emits the JCS text of the state (ASCII; ADR-0013 §D3 subset; throws on a value outside the subset —
programmer error). `parseState` validates every field, invariant (tile conservation, sorted racks, row lengths,
`result` present iff finished) and `engineRulesVersion` (`RULES_VERSION_UNSUPPORTED` before `MALFORMED_STATE`), and
returns a state deep-equal to the one serialised (P-GLOBAL-04). `stateHash` is computed on demand only (not inside
`apply`, ADR-0013 budget).

### 13.7 Input trust
Typed callers are trusted for state values produced by this package (`createMatch`, `apply`, `parseState`); a
hand-built invalid `MatchState` is a programmer error (undefined result, never an infinite loop). **Actions are
never trusted**: they come from players, bots and logs, so `apply`/`evaluateMove` check their runtime shape (§8.2
`malformed`). Persisted states are re-entered only through `parseState`. Network payloads are additionally parsed by
`packages/protocol` (zod) in Phase 2.

## 14. RNG subpath and action log

### 14.1 `@codelex/game-engine/rng` (ADR-0013 §D1, golden vectors Appendix A)

```ts
export type RngState = readonly [number, number, number, number];   // u32 words s0..s3

/** Stateful generator over a private copy of the state. The engine creates one per use and never shares it. */
export interface Rng {
  /** One xoshiro128** step, u32. */
  next(): number;
  /** Uniform in [lo, hi), rejection sampling; throws if !(lo < hi) or hi − lo > 2^32 (programmer error). */
  int(lo: number, hi: number): number;
  /** Current state (for persisting the 'bag' stream). */
  state(): RngState;
}

/** SHA-256(seedHex ':' streamName)[0..16) as four big-endian u32; all-zero → s0 = 1. */
export function deriveStream(seed: SeedHex, streamName: string): RngState;
export function createRng(state: RngState): Rng;
/** Fisher–Yates, descending i (ADR-0013 §D1). Returns a new array; the input is not modified. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[];
/** 'bot:<seat>:<n>', n = state.actionCount before the bot's decision. */
export function botStreamName(seat: Seat, n: number): string;
export function isSeedHex(value: string): value is SeedHex;
```

Bot hosts (app, simulator, `services/ai`) hold the seed and pass bots `createRng(deriveStream(seed,
botStreamName(seat, observation.actionCount)))`; bots never receive the seed (ADR-0013 §D1, §D9).

### 14.2 Action log and replay (ADR-0013 §D2)

```ts
export interface ActionLog {
  readonly logVersion: 1;
  readonly header: MatchConfig;
  /** Accepted actions only, canonical form. */
  readonly actions: readonly Action[];
  /** Optional; state hash after each action, same length as actions. */
  readonly stateHashes?: readonly StateHash[];
  /** Optional; present once the match is over. */
  readonly final?: { readonly stateHash: StateHash; readonly actionCount: number };
}

export type ReplayError =
  | { readonly kind: 'replay'; readonly code: 'LOG_VERSION_UNSUPPORTED'; readonly message: string;
      readonly details: { readonly logVersion: number } }
  | { readonly kind: 'replay'; readonly code: 'RULES_VERSION_UNSUPPORTED'; readonly message: string;
      readonly details: { readonly engineRulesVersion: number } }
  | { readonly kind: 'replay'; readonly code: 'LEXICON_MISMATCH'; readonly message: string;
      readonly details: { readonly expected: string; readonly actual: string } }
  /** Schema violation, unknown key, non-canonical action, INVALID_CONFIG header, length mismatches. */
  | { readonly kind: 'replay'; readonly code: 'MALFORMED_LOG'; readonly message: string;
      readonly details: { readonly path: string } }
  | { readonly kind: 'replay'; readonly code: 'ACTION_REJECTED'; readonly message: string;
      readonly details: { readonly index: number; readonly rejection: Rejection } }
  /** index = action index; 'final' when the final checkpoint differs. */
  | { readonly kind: 'replay'; readonly code: 'HASH_MISMATCH'; readonly message: string;
      readonly details: { readonly index: number | 'final'; readonly expected: StateHash; readonly actual: StateHash } };

export interface ReplayOutcome {
  readonly state: MatchState;
  readonly finalHash: StateHash;
  /** Present iff options.recordHashes: hash after each action (to write stateHashes into a log). */
  readonly stateHashes?: readonly StateHash[];
}
```

- `parseActionLog` order: JSON → `logVersion` → `header.engineRulesVersion` → schema (strict, unknown keys
  rejected) → canonical form of every action → `stateHashes.length === actions.length`,
  `final.actionCount === actions.length`.
- `replay` = `createMatch(header)` then `apply` per action, verifying each `stateHashes[i]` (first divergence wins)
  and `final.stateHash`. The lexicon check happens once, before the first action.
- Building a log: `newActionLog(config)`, then append `applied.action` after each successful `apply`
  (rejections are never logged, ADR-0013 §D2). The log is only exported for finished matches in online play (§D9).

## 15. Versioning

- **`engineRulesVersion`** (integer, `ENGINE_RULES_VERSION`): bumped by any change that alters an outcome for some log
  (ADR-0013 §D5) — **including any change to `MatchState` field names, encodings or value evolution, any change to
  `MatchSetup` accepted values, the hash or JCS rules, and any new action type, format, mode, layout or letter
  table.** `createMatch`/`apply`/`replay`/`parseState` refuse other versions (`RULES_VERSION_UNSUPPORTED`).
- **`logVersion`**: envelope/header/action-encoding changes (ADR-0013 §D2). Readers keep every published version.
- **Package semver** governs only non-hashed API (events, observation, breakdown, rejection details, function
  signatures). Breaking changes there are coordinated with bots/mobile in the same PR; never used for pinning.
- Golden files: `test/golden/{rng,sha256,jcs}.json`, `test/golden/replays/v1/*.json` (GC-DET-01 + seeded corpus),
  `test/golden/scoring/v1/*.json` (RULE_PROPERTIES §3.1/§3.2 transcribed). Immutable once `v1` is published.

## 16. Rules ambiguities surfaced by this API (to `game-designer`; default reading implemented, tests `@ambiguous`)

| ID | Question | Default reading in v1 |
|---|---|---|
| Q-GD-1 | R-TURN-004 in FFA after a resignation: is the limit 3 × `config.seats` or 3 × seats still active? | 3 × **active** seats, evaluated after each turn-ending action (keeps "every remaining player passed three times"). A RESIGN never triggers the check by itself. |
| Q-GD-2 | R-SCORE-006 with a resigned FFA seat: does the goer add the retired rack; does the retired seat subtract it? | Retired racks are out of play: neither added nor subtracted. |
| Q-GD-3 | R-END-002/003 FFA ranking of resigned seats. | Below every active team; among resigned, later resignation ranks higher. **E3 implementation (2026-10-03):** `MatchState` does not record the order of earlier resignations, so non-active teams currently **share** the place after the active teams. Keeping "later ranks higher" needs a hashed field (e.g. `SeatState.resignedAt`), i.e. a decision before the first published replay. |
| Q-GD-4 | R-END-003 tie-break step 2 with ≥ 3 teams tied in FFA ("the seat that did not move first"). | Among tied teams, the one whose earliest seat moves **latest** in turn order from `firstSeat` wins. |
| Q-GD-5 | Are final racks public when the match ends? | Yes (`MATCH_ENDED.finalRacks`, `Observation.finalRacks`); needed to explain R-SCORE-006 adjustments. |

## 17. Purity and error-handling conventions

1. **No mutation of inputs**, ever (state, action, observation, ctx). Tests deep-freeze inputs (P-GLOBAL-01).
   Returned objects are not frozen (cost on Hermes) but are typed `readonly`; consumers must not mutate them, since
   unchanged parts are shared between states.
2. **No ambient inputs:** no `Date`, `Math.random`, `performance`, `crypto`, `Intl`, `process`, timers, globals,
   async; no module-level mutable state or caches (a `WeakMap` cache is module state too: not in v1). Lint-enforced
   (config presets) plus ADR-0013 §D4 rules: integers only, explicit total-order comparators, no reliance on
   `Map`/`Set`/object-key iteration order, ASCII only, recursion depth ≤ 64.
3. **Expected failures are values:** `Result` with typed errors (`kind` + `code` + `message` + typed `details`).
   `kind` separates `rejection` (player), `engine` (system), `replay` (log). Never a bare string, never a stack.
4. **Throw only for programmer errors** (contract violations by typed callers: invalid `Rng.int` range, JCS
   value outside the subset, `observe` with an unknown seat, hand-built invalid state). Messages contain no player
   data.
5. **Exhaustiveness:** every `switch` over `Action['type']`, `Rejection['code']`, `MatchEvent['type']` ends in
   `assertNever`; adding a member breaks every consumer at compile time, on purpose.
6. **Determinism of outputs, not only state:** events, breakdown order, rejection precedence and `not_in_lexicon`
   word order are fixed so that tests and analytics are reproducible.

## 18. Test obligations and budgets

New API-level properties (in addition to every P-GLOBAL / P-<rule> of RULE_PROPERTIES):

| ID | Property | Kind |
|---|---|---|
| P-API-01 | `evaluateMove` ≡ `apply` on acceptance, rejection code and breakdown (§13.4) | PBT (G-STATE, G-ACTION-ANY) |
| P-API-02 | `previewScore(observe(s,p), tiles)` non-null ⇔ geometry + rack pass; equals `Σ base + fullStack` of the accepted breakdown when the move is accepted | PBT |
| P-API-03 | `observe` is invariant under hidden-information changes (§13.3); no observation field contains the seed, `rng`, or another seat's rack | PBT |
| P-API-04 | `eventsFor(e, v)` never contains another seat's drawn/returned tiles | PBT |
| P-API-05 | Breakdown sums: `total = Σ words.total + fullStack + chain`; `seatScore` delta = `breakdown.total` | PBT |
| P-API-06 | `parseActionLog(serializeActionLog(l))` deep-equals `l`; non-canonical or unknown-key logs → `MALFORMED_LOG` | PBT + fixtures |
| P-API-07 | `replay(log)` of every match built through `apply` reaches the same state and hash; a flipped hash pinpoints its index | PBT |
| P-API-08 | Rejection precedence §8.3: an action violating several checks returns the earliest one | PBT |
| P-API-09 | `LEXICON_MISMATCH` from every entry point with a foreign index; state unchanged | unit |

Budgets (estimates until E4 measures them; Node 22 server class / Hermes reference device):

| Operation | Budget |
|---|---|
| `apply` | p99 < 1 ms Node (agent rule); < 10 ms Hermes |
| `evaluateMove` | p99 < 50 µs Node, < 1 ms Hermes per candidate (bots evaluate shortlists, not every generated move) |
| `observe` | < 20 µs Node |
| `previewScore` | < 50 µs Node, < 2 ms Hermes (runs on every drag) |
| `stateHash` / `serializeState` | ADR-0013: < 50 µs / < 2 ms; never inside `apply` |
| `replay` Classic 1v1 | < 40 ms Node (ADR-0013) |

## 19. Consumer guide (who uses what)

| Consumer | Uses | Must not |
|---|---|---|
| E2–E4 (engine) | implements §4–§14 verbatim | add fields to `MatchState` without this note and the version rule |
| L2 (`@codelex/lexicon/index`) | exports `FormRef`, `TermRef`, `LexiconVersion`, `Difficulty`, `CategoryId`, `LexiconIndex` with the `EngineLexicon` members of §5 | — |
| B1 (`packages/bots`) | `Observation`, `evaluateMove`, `getLayout`, `getLetterTable`, `RULES`, `./rng`; GADDAG and `crossCheck` from the index | read `MatchState`, receive the seed, re-implement scoring or validation, use wall clock |
| `apps/mobile` (E-1.5) | `createMatch`, `apply`, `observe`, `eventsFor`, `previewScore`, `serializeState`/`parseState` (snapshots), action log + `replay` (AC-20 "Send match log"), `stateHash` | compute scores, decide validity, show `message` to users |
| `services/game` (Phase 2) | all of `.`; maps events to `match.*.v1`; stores logs and checkpoints | send `MatchState` or full events to clients (only `observe`/`eventsFor` output) |

## 20. Review questions

For **solution-architect**:
1. API-1: is `MatchConfig` ≡ log header (with the nested key `config: MatchSetup`) acceptable, or should the header
   flatten `config` before the first log is written? (One-way once Phase-2 logs exist.)
2. API-2/API-3: confirm "every `MatchState` field is hashed" and the no-boolean/no-null rule (`requireWinner: 0 | 1`)
   for state and log, versus allowing booleans in JCS (RFC 8785 supports them; ADR-0013 restricted the subset).
3. API-5: three error families (`rejection` lowercase rule codes, `engine` and `replay` UPPER_SNAKE) discriminated by
   `kind` — consistent with ENGINEERING §4 and what `packages/protocol` will need for problem+json mapping?
4. Should `teams`, `layout`, `letters` stay in `MatchSetup` although rules version 1 allows one value each (self-
   describing logs, future multi-layout versions), or be implied by `engineRulesVersion` to shorten logs?
5. `format: 'untimed'` (2–4 seats) added now to avoid a later bump: agree, or keep v1 to `untimed-vs-bot` only and
   accept a bump when 2v2/FFA ship?
6. Events (§9) as engine outputs with `eventsFor` redaction: is this the right seam for Phase 2 `match.*.v1` and
   spectating, or should redaction live in `services/realtime`?
7. Is `parseState` (snapshot resume, E-1.5 "action log + periodic snapshot") acceptable as a second trusted entry
   point next to `replay`, or should mobile always resume by replaying the log?

For **ai-engineer**:
8. API-6: `evaluateMove(observation, action, ctx)` instead of `(state, …)` — does it fit `chooseAction(observation,
   ctx)` and the simulator, which holds full states?
9. Is the `evaluateMove` budget (< 50 µs Node, < 1 ms Hermes per call) enough for Beginner/Strategist, or do bots
   need a cheaper path (e.g. a variant that skips lexicon lookups for GADDAG-generated words, which would be a second
   scoring path and needs a parity property)?
10. Is `MoveEvaluation` (`breakdown`, `leave`, `goesOut`) sufficient, or do you need cross-word anchors/new-tile
    premium data exposed too?
11. `Observation.unseen` as 27 counts (blank at index 26) and racks as sorted strings: convenient for leave
    evaluation and Hermes performance, or prefer `Uint8Array` / code arrays?
12. Bot RNG: host derives `bot:<seat>:<observation.actionCount>` and passes an `Rng` — confirm `actionCount` in
    the observation is the `n` you need, and that no other stream is required by B1.

For **lexicon-engineer** (L2, FYI): 13. Confirm the member names `termOf(FormRef): TermRef`, `lookup`/`lookupCodes`
returning `FormRef`, and that `meta(TermRef).form` is the canonical form (§5).
**Answered 2026-10-02 (sprint L2):** confirmed as written, no change to §5. `@codelex/lexicon/index` exports
`lookup`/`lookupCodes` → `FormRef | undefined`, `termOf(form: FormRef): TermRef`, and `meta(term).form` is always
the canonical form (`meta(termOf(lookup('PODS'))).form === 'POD'`). The full `LexiconIndex` also has
`formMeta(FormRef)` (`{ ref, form, term, kind }`) and `termCount` (`size` counts forms); neither is in
`EngineLexicon`. Recorded as Q-L13 in the lexicon-index note §9; normative source
`packages/lexicon/src/index/types.ts`.
