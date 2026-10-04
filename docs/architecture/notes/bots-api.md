# Design note — `@codelex/bots` public API and the Beginner bot (E-1.3)

- Status: Proposed · Date: 2026-10-03 · Owner/author: ai-engineer (contract proposed by solution-architect;
  Beginner design with game-designer reasoning, decisions delegated by the product owner)
- Reviewed-by: pending solution-architect, game-designer; lexicon-engineer delivered the §4.3 DAWG accessor (L5, #47)
- Updated 2026-10-03 (B2): §4.3 DAWG fallback implemented, §6 Q-A2 measured, §9 O-1 closed, §5.4 first
  calibration readout (`docs/game/sim/2026-10-b2-readout.md`).
- Updated 2026-10-04 (sprint 3, ST0): §5.4 targets restated per b2-response D2 (BG-2a/2b). §5.5 adds the
  Strategist personality data, specified in `docs/specs/E-1.3-bots/strategist.md`. §5.6 is the `BOT_VERSION` 2
  plan. §6 replaces the provisional Strategist budget. §7 pins goldens per (`BOT_VERSION`, `engineRulesVersion`).
  This is a plan only: the code stays at `BOT_VERSION` 1 until B4.
- Sprint: `docs/sprints/2026-10-03-phase1-bots-app-foundation.md` — B0 (this note). Unblocks B1 (bots), B2
  (simulator), H1 (device timing), S1 (first playable slice).
- Inputs (normative, this note never overrides them): `docs/adr/0013-determinism-replay-contract.md` (ADR-0013,
  §D1 streams, §D4 determinism, §D9 secrecy), `docs/architecture/notes/game-engine-api.md` (API note: §10
  `Observation`, §13.4 `evaluateMove`, §18 budgets, §19), `docs/architecture/notes/lexicon-index.md` (§2.3 GADDAG,
  §5 budgets, Q-A1/Q-A2), `docs/game/BALANCE.md` (B-01, B-07), `docs/game/GAME_RULES.md` v0.3.1,
  `docs/specs/E-1.5-play-vs-bot/classic-match-vs-bot.md` (AC-8, AC-9, AC-11, F-7/F-8/F-9).

No ADR: everything here is a two-way door (package semver) because bot choices are never replayed: the action
log stores the bot's **actions**, not its reasoning (ADR-0013 §D2). Timings are **estimates** until B1/H1 measure them.

## 1. Scope

**In `packages/bots`:** anchors and cross-check masks for a board, move generation (GADDAG, DAWG fallback),
vocabulary filtering, candidate ranking, personality data, the rule-correct fallback.

**Not in `packages/bots`:** scoring and validation (`evaluateMove`, API-6; never re-implemented), the RNG seed and
stream derivation (host, ADR-0013 §D1), think delays (presentation, R-MODE-CLASSIC-002), threads/workers (app),
LLM anything (`services/ai` Coach; never in the gameplay path). Strategist is specified in
`docs/specs/E-1.3-bots/strategist.md` and §5.5, and implemented in sprint 3 task B4.

## 2. Decisions

| ID | Decision | Rationale |
|---|---|---|
| BOT-1 | One entry point `chooseAction(obs, ctx)`, **synchronous and pure** apart from consuming the fresh `ctx.rng` it is given. Same `(obs, lexicon, rng state, personality, budget)` ⇒ deep-equal `BotDecision`. | AC-11 "recomputes the same move" after a kill; ADR-0013 §D4; lint presets already ban clocks, timers, async in `packages/bots`. |
| BOT-2 | The host derives `ctx.rng = createRng(deriveStream(seed, botStreamName(seat, obs.actionCount)))`. Bots never receive the seed, `MatchState`, or the bag (lint: `no-restricted-imports` of `MatchState`, `apply`, `createMatch`, `replay`, `parseState`, `deriveStream` in `src/`; tests may use them). | ADR-0013 §D1, §D9; API note API-6, §19. |
| BOT-3 | A **node** = one successful automaton transition followed by the generator (`next(...) !== -1`, the GADDAG separator arc included), in either automaton. Cross-check masks (≤ 2 × 225 `crossCheck` calls, bounded by the board) are computed once per decision, outside `maxNodes`, and counted in the fixed cost of §6. | Budgets are counts, never wall clock (ADR-0013 §D4.6); a count is device-independent, so a slow phone picks the same move as a fast one. |
| BOT-4 | **Budget exhaustion returns best-so-far**: generation stops at `maxNodes`; the moves found so far are ranked. `maxCandidates` caps `evaluateMove` calls. `budgetExhausted` is true iff either cap dropped work. Exhausted with zero candidates ⇒ fallback (BOT-6). | Bounded latency on any position (two blanks multiply the search by up to 26²). |
| BOT-5 | Ranking by an **integer key**, ties broken by the canonical action key (§4.4) in code-unit order. Every fractional quantity is an integer (permille, weights). | ADR-0013 §D4.1, §D4.3, §D4.7. |
| BOT-6 | **Rule-correct fallback** when no `PLACE_WORD` is chosen: `EXCHANGE` of the whole rack minus blanks (whole rack if it holds only blanks) if `obs.bagCount ≥ RULES.minBagForExchange` (7), else `PASS`. Bots never `RESIGN` in Phase 1. | R-TURN-001; keeps the match moving (a pass with an unplayable rack drifts toward R-TURN-004). Keeping blanks is the one obvious improvement that costs nothing. |
| BOT-7 | Personality data is a frozen table of **integers only** (§5.1), versioned with the package (`BOT_VERSION`, reported in `bot_match_started.bot_version`). | ADR-0013 §D4.1; reproducible simulator runs per bot version. |
| BOT-8 | GADDAG generation when `ctx.lexicon.gaddag` is defined, **DAWG (Appel–Jacobson) fallback** otherwise; same move set (P-BOT-03). | Mobile may omit the GADDAG section (lexicon-index §5 size gate). |
| BOT-9 | Scoring **only** via `evaluateMove`; the bot may read `getLayout`, `getLetterTable`, `RULES`, the board and the lexicon (`lookupCodes`, `termOf`, `difficulty`) for generation and filtering, never to compute points. | CLAUDE.md §1.2; P-API-01 makes "accepted by `evaluateMove`" ⇒ "accepted by `apply`". |

## 3. Contract

```ts
import type { Result } from '@codelex/config/result';
import type { Action, Observation } from '@codelex/game-engine';
import type { Rng } from '@codelex/game-engine/rng';
import type { LexiconIndex } from '@codelex/lexicon/index';

/** `random-legal` is internal (simulator floor, fuzzing); never offered to players. `greedy` is a simulator yardstick. */
export type BotPersonalityId = 'random-legal' | 'beginner' | 'greedy';
// BOT_VERSION 2 (§5.6, B4): | 'strategist'. Spec only; the code is unchanged until B4.

export interface BotBudget {
  /** Max automaton transitions (BOT-3). Safe integer ≥ 1. */
  readonly maxNodes: number;
  /** Max `evaluateMove` calls per decision. Safe integer ≥ 1. */
  readonly maxCandidates: number;
}

export interface BotContext {
  /** Same artefact the match is pinned to (version, profile, definitionHash). */
  readonly lexicon: LexiconIndex;
  /** Fresh per decision, derived by the host from `bot:<seat>:<obs.actionCount>`; consumed by this call only. */
  readonly rng: Rng;
  readonly personality: BotPersonalityId;
  /** Default: `PERSONALITIES[personality].budget`; hosts override only in tests and benchmarks. */
  readonly budget: BotBudget;
}

export interface BotDecision {
  /** Always accepted by `apply` on the state `obs` was observed from (P-BOT-01). Canonical form. */
  readonly action: Action;
  readonly nodesUsed: number;
  readonly candidatesEvaluated: number;
  readonly budgetExhausted: boolean;
}

export type BotErrorCode =
  | 'NOT_A_SEAT'        // obs.viewer === 'spectator'
  | 'MATCH_OVER'        // obs.status === 'finished'
  | 'NOT_ON_TURN'       // obs.seatOnTurn !== obs.viewer
  | 'LEXICON_MISMATCH'  // ctx.lexicon identity ≠ obs (version, profileId, definitionHash); never masked by a fallback
  | 'INVALID_BUDGET';   // non-integer or < 1
export interface BotError { readonly kind: 'bot'; readonly code: BotErrorCode; readonly message: string }

export function chooseAction(obs: Observation, ctx: BotContext): Result<BotDecision, BotError>;
export declare const PERSONALITIES: Readonly<Record<BotPersonalityId, PersonalityData>>;   // §5.1
export declare const BOT_VERSION: number;
```

Errors are host/programmer situations, checked first in the order listed; a bot that is on turn in a running match
with the pinned lexicon always returns `ok`. A generated candidate rejected by `evaluateMove` is dropped (the engine
is authoritative) and is a generator bug caught by P-BOT-04, not a runtime error.

## 4. Move generation

### 4.1 Pipeline (identical for every personality; personalities differ in §5)
1. Guards (§3). Convert `obs.rack` to 27 counts (scratch arrays allocated per call; no module state, API note §17).
2. Cross-check masks per empty square and direction from `crossCheck(before, after)`; anchors = empty squares
   adjacent to a tile, or `layout.start` on an empty board (≥ `RULES.minFirstMoveTiles` tiles).
3. Generate: anchors in `(row, col)` order, direction `row` then `col`, arcs in ascending symbol order, blanks
   after natural letters (a blank tries every arc, placed lowercase). Each complete placement whose new tiles
   satisfy the masks is emitted once, keyed by its canonical key (one-tile moves found in both directions and
   GADDAG duplicates across anchors are dropped). Stop at `maxNodes` (BOT-4).
4. Personality filter, sampling and ranking (§5), calling `evaluateMove(obs, action, { lexicon })` at most
   `maxCandidates` times.
5. Chosen `PLACE_WORD`, else fallback (BOT-6).

### 4.2 GADDAG path
Gordon (1994) over `Gaddag.arcs/next/isFinal` (lexicon-index §2.3): from the anchor, walk left reading reversed
letters from rack or board, cross `◇`, walk right; prune with the masks and remaining rack counts. Recursion depth
≤ 15 + 1 (ADR-0013 §D4.8 limit 64).

### 4.3 DAWG fallback
Appel–Jacobson over `LexiconIndex.dawg` (L5, #47: `root`, `arcs(node)` bits 0..25, `next(node, letter)`,
`isFinal(node)`, over the mandatory DAWG section, so zero size cost), used when `ctx.lexicon.gaddag` is undefined
(`src/movegen/dawg.ts`). For each anchor and direction: if the square before the anchor holds a tile, the left part
is that run of board tiles read through the DAWG; otherwise left parts are built from the rack over the free,
non-anchor squares before the anchor (they have no perpendicular neighbour, so no mask), then extended to the right
through rack and board tiles with the masks. A left part never covers an anchor, so each placement comes from its
leftmost anchor, as on the GADDAG path; keys deduplicate one-tile moves. Same node definition (BOT-3) and budget
handling (BOT-4); rack, placement and dedupe bookkeeping are shared with the GADDAG path (`src/movegen/common.ts`).
Generation order differs from the GADDAG's, so decisions can differ only when a cap drops work (P-BOT-03, tested on
reference tries and decoded `.clxi` automata, real and synthetic lexicons).

### 4.4 Canonical action key (tie-break)
`P` followed by, per canonical tile, `RRCCt` (2-digit row, 2-digit column, tile char); `X` + sorted tiles for an
exchange; `S` for a pass. A bijection of the §D2 canonical form, so ordering it by code unit is the total order
ADR-0013 §D4.7 asks for without using `JSON.stringify` (banned for comparisons, §D4.2).

## 5. Personalities

### 5.1 Data (integers only)

```ts
export interface PersonalityData {
  readonly budget: BotBudget;
  /** Hardest main-word difficulty kept (0 novice … 3 expert); ignored if it empties the candidate set. */
  readonly maxDifficultyRank: 0 | 1 | 2 | 3;
  /** Candidates kept before evaluation when generation yields more than budget.maxCandidates: uniform sample with ctx.rng. */
  readonly sampleWhenOver: 0 | 1;
  /** Integer weights for the top-N after ranking by breakdown.total; length = N. [1] = always the best. */
  readonly topWeights: readonly number[];
  /** Weight multiplier for main words of length ≤ shortLength (1 = neutral). */
  readonly shortLength: number;
  readonly shortMultiplier: number;
  /** Permille chance to ignore every Full Stack (7-tile) candidate in a decision. */
  readonly skipFullStackPermille: number;
}
```

| Field | `random-legal` | `beginner` | `greedy` (yardstick, not shipped) |
|---|---|---|---|
| `budget` | 200,000 / 8 | 200,000 / 300 | 400,000 / 2,000 |
| `maxDifficultyRank` | 3 | 1 (intermediate) | 3 |
| `sampleWhenOver` | — | 1 | 0 (evaluates in generation order) |
| `topWeights` | — (uniform pick, then 1 verification call) | `[8, 5, 3, 2, 1]` | `[1]` |
| `shortLength` / `shortMultiplier` | — | 5 / 2 | — / 1 |
| `skipFullStackPermille` | 0 | 500 | 0 |

### 5.2 Random-legal bot
Uniform pick (`ctx.rng.int(0, n)`) among the deduplicated generated `PLACE_WORD`s, then one `evaluateMove` to
confirm (on rejection: drop, redraw, within `maxCandidates`); none ⇒ fallback. It ignores score entirely. Purpose: rung 0 of the ladder
(Beginner must beat it ≥ 80 %), a fuzzer of reachable boards for Q4/P-BOT tests, and the cheapest sanity check of
the no-legal-word rate. Never selectable in the app.

### 5.3 Beginner: how it picks a move
Game-design intent (F-8): a newcomer who knows mostly everyday tech words, plays what they see rather than the best
move, likes short words, does not plan the rack, and sometimes misses the big play. Procedure:
1. **Vocabulary filter:** keep candidates whose main word's canonical term is novice or intermediate
   (`difficulty(termOf(lookupCodes(...)))`); cross-words are incidental and not filtered. Empty ⇒ unfiltered set.
2. **Attention:** if more than `maxCandidates` remain, sample `maxCandidates` uniformly (partial Fisher–Yates on
   the canonical-key-sorted list, `ctx.rng`). A human does not see every move either; this also bounds the
   evaluation cost without any pre-score (which would be a second scoring path).
3. Evaluate with `evaluateMove`; rank by `breakdown.total` desc, ties by canonical key (§4.4). **Leave is ignored.**
4. **Missed Full Stack:** if the best candidate places 7 tiles, with `rng.int(0, 1000) < skipFullStackPermille` (500) every 7-tile
   candidate is removed for this decision.
5. **Pick:** weight of rank i = `topWeights[i] × (mainLength ≤ 5 ? 2 : 1)`; draw `rng.int(0, Σw)`. Before the length
   multiplier the best move is picked 8/19 ≈ 42 % of the time, the second ≈ 26 %.
6. **No voluntary exchange** (F-8 "never exchanges before turn 5" is satisfied a fortiori); BOT-6 still exchanges
   when no word exists, at any turn. Deviation from a literal reading of F-8, flagged for game-designer (§9 O-2).

RNG draws happen in a fixed order (sample, Full Stack check, pick), so the decision is a function of the stream.

### 5.4 Beginner strength (B-07 ladder, human target)
- **Ladder:** random-legal (rung 0, not part of B-07) < **Beginner (rung 1)** < Strategist < Architect <
  Grandmaster. B-07 requires each rung to beat the previous ≥ 60 %; Beginner is designed far enough below a
  score-maximiser that Strategist clears 60 % with margin (expected ≥ 75 %).
- **Human target:** E-1.5 guardrail "human win rate vs Beginner ≥ 55 %" (F-9; below 55 % = too hard). We cannot
  simulate humans, so B2 calibrates against the `greedy` yardstick (best `breakdown.total`, no filter) and the
  playtest confirms. Assumption (reversible, recorded): a first-time human plays at roughly "a decent move among
  the visible ones", i.e. well below greedy. Simulator targets at batch 2, final at E-1.6 (≥ 2,000 forms):

| ID | Metric (≥ 1,000 seeded matches, seats swapped) | Target |
|---|---|---|
| BG-1 | Beginner vs random-legal win rate | ≥ 80 % |
| BG-2 | greedy vs Beginner win rate | 65–85 % (lower bound: Beginner is clearly beatable; upper: not a pushover) |
| BG-3 | Beginner mean points per accepted `PLACE_WORD` ÷ greedy's | 55–75 % |
| BG-4 | Beginner main words that are novice/intermediate | ≥ 90 % |
| BG-5 | `budgetExhausted` rate (Beginner, GADDAG path) | ≤ 1 % of decisions |

- **Tuning levers**, in order: `topWeights` (flatter = weaker), `maxDifficultyRank`, `skipFullStackPermille`,
  `budget.maxCandidates` (attention). A miss in the playtest (human win < 55 % or average loss margin > 100
  points, F-9 `score_margin`) is fixed by a data change and a `BOT_VERSION` bump.
- **First readout (B2, 2026-10-03, batch 2: 1,501 forms; `docs/game/sim/2026-10-b2-readout.md`):** BG-1
  64.5 % [61.4, 67.4] (miss), BG-2 98.8 % [97.9, 99.3] (miss), BG-3 63.6 % (ok), BG-4 87.7 % (slight miss),
  BG-5 0 % (ok), over 22,000 replay-verified matches. Candidate sets are tiny at this lexicon size (Beginner
  chooses among p50 3, p95 22 moves), and the vocabulary filter forgoes the advanced/expert term bonus, which is
  37–44 % of all points. `BOT_VERSION` stays 1 until game-designer confirms or restates BG-1..BG-5 (O-2) for
  batch 3.
- **Restated targets (game-designer, `docs/game/decisions/2026-10-b2-response.md` D2; apply from `BOT_VERSION`
  2, final reading at batch 3):**
  - BG-1 ≥ 80 %, unchanged.
  - **BG-2a** (new): vocabulary-matched greedy vs Beginner, **65–85 %**. The yardstick is `greedy` with
    `maxDifficultyRank` 1, applied as a simulator-side personality override; no new public id.
  - **BG-2b** (formerly BG-2): full-vocabulary greedy vs Beginner, reported only. The gap is the intended
    knowledge reward, and human fit is judged by F-9.
  - BG-3 55–75 %, BG-4 ≥ 90 % and BG-5 ≤ 1 %, all unchanged.

  BG-5 is re-read under the `BOT_VERSION` 2 budget (§5.6). The batch-3 proxy with `[16,6,2,1]` gives BG-1 84.7 %,
  BG-2a 69.0 %, BG-3 70 % and BG-4 93.8 %.

### 5.5 Strategist (personality data, `BOT_VERSION` 2)

The feature spec is `docs/specs/E-1.3-bots/strategist.md`: persona, the full decision model S-1..S-5, the ST-x
targets, the budget derivation and the open questions GD-1..GD-8. This section fixes only the **data shape and
starting values**. B4 tunes the values on tuning seeds before freezing them with `BOT_VERSION` 2.

Strategist uses the same pipeline (§4.1). The differences:

- a deterministic overflow shortlist (attention key, no random draw, no letter values);
- a utility `U = 10 · breakdown.total + L + C + D` in tenths of a point, instead of `breakdown.total`;
- a voluntary-exchange rule;
- a keep-set on the forced (no-word) exchange.

All values are integers; weighted terms use an integer `floorDiv` (ADR-0013 §D4.1).

```ts
/** Strategist-only knobs (spec S-1..S-4). `null` for every other personality. Units: dp = tenths of a point. */
export interface StrategyData {
  // L: leave (S-2)
  readonly leaveBlankDp: number;              // 150
  readonly leaveBaseDp: number;               // 20   tileDp(l) = max(leaveFloorDp, leaveBaseDp − leavePerValueDp · v(l)) + bonus[l]
  readonly leavePerValueDp: number;           // 10
  readonly leaveFloorDp: number;              // −60
  readonly leaveLetterBonusDp: readonly number[]; // 26 entries, index = LetterCode: S (18) = 30, others 0
  readonly vowelIdealPermille: number;        // 350
  readonly vowelOffDp: number;                // 30
  readonly vowelAllOrNoneDp: number;          // 40  (n ≥ 3 and no vowel or only vowels)
  readonly duplicateDp: number;               // 25  per extra copy, blanks exempt
  readonly leaveLowBagPermille: number;       // 400 (bag 1–6; bag ≥ 7 = 1000)
  readonly endgameRackDp: number;             // 20  per point of value, bag empty
  // C: chain preference (S-2)
  readonly chainKeepDp: number;               // 25  × breakdown.chainKAfter
  readonly chainDegreeDp: number;             // 3   × min(neighbours(mainTerm).length, chainDegreeCap)
  readonly chainDegreeCap: number;            // 8
  // D: lane blocking / premium denial (S-2)
  readonly laneReach: number;                 // 4
  readonly hotTwDp: number;                   // 60
  readonly hotDwDp: number;                   // 20
  readonly leadThreshold: number;             // 30 points
  readonly trailThreshold: number;            // 50 points
  readonly denialLeadPermille: number;        // 1500
  readonly denialEvenPermille: number;        // 1000 (also whenever the bag is empty)
  readonly denialTrailPermille: number;       // 400
  // X: voluntary exchange (S-4); RULES.minBagForExchange is read from the engine, not duplicated
  readonly exchangeMaxScoreless: number;      // 2   obs.scorelessTurns ≤ this
  readonly exchangeMaxScore: number;          // 14  points, best-U candidate's breakdown.total ≤ this
  readonly exchangePoorLeaveDp: number;       // −80 raw(best-U leave) ≤ this
  readonly exchangeGainDp: number;            // 150 raw(K*) − raw(best-U leave) ≥ this
}

// PersonalityData gains:  readonly strategy: StrategyData | null;
```

The common `PersonalityData` fields for `strategist`:

| Field | `strategist` | Note |
|---|---|---|
| `budget` | **70,000 / 500**, unconditional (§6.1; game-designer GD-7 with the P7 size-gate input) | One budget on every host and both automata |
| `maxDifficultyRank` | 2 (advanced) | GD-1. Ignored if it empties the set, as for Beginner |
| `sampleWhenOver` | 0 | With `strategy ≠ null`, overflow uses the attention key `8 · tilesPlaced + 4 · (DW+TW covered) + (DL+TL covered)`, ties by canonical key |
| `topWeights` | `[10, 6, 3, 1]` over `U` | Best move 50 % (GD-2; tuning range `[8,5,3,2,1]`..`[16,6,2,1]`). This is the first strength lever (ST-1b) |
| `shortLength` / `shortMultiplier` | 0 / 1 | Neutral |
| `skipFullStackPermille` | 0 | — |
| `strategy` | the starting values above | — |

RNG: at most one draw (`topWeights`), taken after the exchange decision. The exchange decision and the shortlist
use no randomness. Properties to add in B4: P-BOT-01, 02, 03 and 05 extended to `strategist`. P-BOT-06 for
Strategist reads "no word ⇒ EXCHANGE of `rack − K*` (≥ 1 tile) iff `bagCount ≥ 7`, else PASS". The new P-BOT-09
is "no voluntary EXCHANGE when `scorelessTurns > exchangeMaxScoreless` or `bagCount < 7`".

### 5.6 `BOT_VERSION` 2 plan (sprint 3, B4)

A single bump carries every behaviour change of the sprint. The sprint plan makes one decision: device numbers
come later and mean `BOT_VERSION` 3.

| # | Change | Source |
|---|---|---|
| V2-1 | Beginner `topWeights` `[8, 5, 3, 2, 1]` → **`[16, 6, 2, 1]`**; every other Beginner field unchanged | b2-response D2, T-1 |
| V2-2 | Beginner `budget` 200,000 / 300 → **70,000 / 300** (device worst case 1.29 s on f1, 1.71 s on f0, against 2.85 s / 4.05 s before). BG-5 is re-read in B4; if it exceeds 1 % because of two-blank racks, 100,000 / 300 instead (f0 worst case 2.25 s) | §6, spec GD-7 |
| V2-3 | `BotPersonalityId` gains **`'strategist'`**; `PERSONALITIES.strategist` per §5.5; `PersonalityData.strategy` (`null` for the others) | spec ST0 |
| V2-4 | Strategist budget 70,000 / 500 on both automata | §6.1 |
| V2-5 | `random-legal` and `greedy` unchanged (simulator only, server class). The BG-2a yardstick is a simulator override of `greedy`, not a new id | T-1 |
| V2-6 | `BOT_VERSION` = 2, reported in `bot_match_started.bot_version` | BOT-7 |

Order inside B4:

1. **Cheaper key build** as a pure refactor under `BOT_VERSION` 1. Full canonical keys (§4.4) are built only for
   candidates kept for evaluation; dedupe uses a packed integer placement signature. `decisions-v1.json` must
   pass unchanged, and P-BOT-03 must hold. Re-measure the Node `c_node`.
2. If P3 has landed Hermes-CLI constants, or step 1 moved the Node `c_node`, re-apply the §6 formula once and
   record the result in §6 and in the spec.
3. Apply V2-1..V2-6 together and re-pin the goldens (§7).
4. Run the ST-x runs and the BG re-read on tuning seeds. Freeze the data. Run the pre-registered ST-1 (B-07)
   confirmation on its own seeds.

**Goldens, pinned per (`BOT_VERSION`, `engineRulesVersion`):**

- `test/golden/decisions-v1.json` stays as the frozen record of (1, 1). It is no longer executed once the code is
  at 2, because bot reasoning is never replayed (ADR-0013 §D2).
- B4 adds `decisions-b2-r1.json`, and `decisions-b2-r2.json` once `engineRulesVersion` 2 is frozen (R4). While v2
  is a draft, a `decisions-b2-r2-draft.json` may exist; it is not a required check.
- Each file holds 20 seeded positions × each personality (Strategist included). Positions are chosen so that no
  cap binds, and the test asserts that f1 and f0 give the same decision on them. Expected decisions are computed
  on the automaton the app ships (f0 unless P7 locks f1), and the file records it; any position where a cap binds
  is labelled and asserted on that automaton only (P-BOT-03 guarantees equality only when no cap binds).
- A changed golden without a version bump fails review. The P3 golden-immutability check is the natural place to
  enforce it.

## 6. Node budget ↔ device latency (toward E-1.5 AC-8)

AC-8 (the sprint plan's B0 row cites AC-9; the latency clause is in AC-8): bot **compute** p95 ≤ 2 s on the
reference device for Strategist, total perceived ≤ 4 s with a 1.2–4 s think delay. Model (estimates; H1 replaces
them with measured constants on Hermes and a real low-end Android):

`T ≈ T_fixed + nodesUsed × c_node + candidatesEvaluated × c_eval`

| Constant | Node 22 (server/sim) | Hermes, reference device | Basis |
|---|---|---|---|
| `T_fixed` (observe, rack counts, ≤ 450 `crossCheck`, dedupe) | < 2 ms | ≤ 150 ms | lexicon-index §5 `has()` 1–5 µs × ≤ 26 suffix walks |
| `c_node` (transition + mask/rack bookkeeping + recursion) | ≈ 0.1 µs | ≤ 2 µs | `has()` per-letter cost ×≈ 5 bookkeeping |
| `c_eval` (`evaluateMove`) | < 50 µs | < 1 ms | API note §18 (p99 budget) |

| Personality | `maxNodes` | `maxCandidates` | Worst case on device | Target |
|---|---|---|---|---|
| Beginner | 200,000 | 300 | 150 + 400 + 300 = **850 ms** | compute p95 ≤ 1 s (hidden under the 1.2 s minimum delay) |
| Strategist (provisional, superseded 2026-10-04 by §6.1) | ~~400,000~~ | ~~800~~ | 150 + 800 + 800 = 1.75 s (at the disproved 2 µs `c_node`) | AC-8 p95 ≤ 2 s |

Expected usage (estimate): full GADDAG generation ≤ 20,000 nodes for a mid-game rack at 2,000 forms, so the
Beginner cap is a safety net (BG-5), not a strength knob; it binds only on blank-heavy racks. Rule for later
recalibration: `maxNodes = ⌊(T_target − T_fixed − maxCandidates × c_eval) / c_node⌋` with H1's measured
constants, changed only with a `BOT_VERSION` bump. Compute runs off the UI thread (app concern, AC-8).

**B1 benchmark exit criterion — Q-A2** (lexicon-index §9; "is DAWG-only fast enough for Strategist within 2 s?"):
on ≥ 200 seeded mid-game positions (from Beginner mirror games) at the real index and the 2,000- and 50,000-form
synthetic fixtures, B1 reports p50/p95/max **nodes and Node-ms** of unbounded generation, GADDAG vs DAWG, plus
blank-rack worst cases. Pass if the DAWG path's p95 nodes ≤ 400,000 at 50,000 forms (Strategist fits 2 s at the
estimated `c_node`); H1 converts with measured Hermes constants. Fail ⇒ mobile must ship the GADDAG section (size
gate permitting) or Strategist gets a DAWG-specific budget; decided with lexicon-engineer before Strategist starts.
Q-A1's trigger (compute p95 > 1 s on device ⇒ arc-final letter sets) is checked with the same data.

**Q-A2 result (2026-10-03, B2): pass.** `pnpm --filter @codelex/bots bench` (`test/qa2.bench.ts`): each fixture is
built as a `.clxi` artefact with and without the GADDAG section and decoded (the shipped minimal automata); 200
positions per fixture from Beginner mirror games (on-turn observations from action 2); unbounded generation. Node
counts are exact. Times are Vitest bench per-position latencies on Node 22.22 (4 vCPU shared host, load ≈ 5, so
indicative only); they include the fixed cost (board view and cross-checks).

| Fixture | Automaton | Nodes p50 / p95 / max | Two-blank nodes p50 / p95 / max | Node ms p50 / p95 / max | Two-blank ms p50 / p95 / max |
|---|---|---|---|---|---|
| real, 1,501 forms | GADDAG | 822 / 2,218 / 22,870 | 20,895 / 46,092 / 60,185 | 1.5 / 3.2 / 34 | 23 / 53 / 75 |
| real, 1,501 forms | DAWG | 839 / 2,094 / 23,670 | 19,395 / 38,257 / 46,939 | 1.9 / 4.6 / 50 | 39 / 79 / 107 |
| synthetic 2,000 | GADDAG | 1,465 / 4,118 / 26,990 | 44,157 / 87,131 / 118,934 | 2.1 / 6.0 / 34 | 48 / 95 / 125 |
| synthetic 2,000 | DAWG | 1,594 / 4,273 / 28,564 | 45,904 / 84,499 / 113,078 | 3.2 / 8.7 / 62 | 86 / 164 / 225 |
| synthetic 50,000 | GADDAG | 8,856 / 90,249 / 243,841 | 477,747 / 1,078,318 / 1,631,497 | 11 / 95 / 345 | 589 / 1,339 / 2,002 |
| synthetic 50,000 | DAWG | **9,465 / 84,469** / 216,607 | 490,742 / 1,064,400 / 1,433,040 | 18 / 136 / 456 | 932 / 2,048 / 2,785 |

- **Criterion met:** DAWG p95 = 84,469 nodes at 50,000 forms (≤ 400,000). Both automata yield the same move set on
  every position (checked in the bench and by P-BOT-03).
- **DAWG vs GADDAG:** with BOT-3's node definition the DAWG needs about as many nodes as the GADDAG (DAWG ÷ GADDAG
  per position p50 / p95 / max: real 100 / 121 / 145 %, 2,000 forms 110 / 183 / 309 %, 50,000 forms 106 / 139 /
  220 %) but costs ≈ 1.3–1.9× the time per position. Dropping the GADDAG section on mobile costs ≈ 1.5× generation
  time, not a different order of magnitude.
- **Candidates** p50 / p95 / max: real 4 / 20 / 292, 2,000 forms 23 / 94 / 527, 50,000 forms 414 / 2,484 / 21,368
  (two blanks: 16,456 / 59,137 / 115,502). Fixed cost p50 / p95: 0.6 / 0.8 ms (real) to 0.8 / 1.3 ms (50,000).
- **`c_node` is 10–20× the estimate above.** Two-blank runs give ≈ 1.2 µs per node (GADDAG) and ≈ 1.9 µs (DAWG) on
  Node, against the 0.1 µs assumed in the constants table; the time includes recording candidates (key, sort),
  which dominates at 50,000 forms. The Hermes guess of ≤ 2 µs per node is therefore optimistic. Consequences:
  Beginner is unaffected at the real lexicon (simulator: p95 ≈ 2,500 nodes per decision, max ≈ 60,000, BG-5 = 0);
  Strategist's provisional 400,000-node cap could take seconds on device and binds on ≈ 69 % of two-blank
  positions at 50,000 forms (137–139 of 200, both automata). Before Strategist starts: H1 measures `c_node` on
  Hermes and a low-end Android, then Strategist's `maxNodes` is set by the rule above (or generation gets cheaper,
  e.g. keys built only for kept candidates). Q-A1 stays as decided until H1 shows compute p95 > 1 s on device.
- Mobile may ship without the GADDAG section from the bots' point of view (lexicon-index §5 size gate); the
  decision stays with lexicon-engineer and mobile-engineer once H1 has device numbers.

### 6.1 Provisional budgets for `BOT_VERSION` 2 (sprint 3 decision, ST0)

H1 has no device yet. Per the sprint 3 decision, the device constants are the **Node measurement × a Hermes factor
of 10**: `T_fixed` 150 ms (estimate kept as margin) and `c_cand` 1.1 ms (`evaluateMove` 1 ms plus Strategist's
terms 0.1 ms; Beginner 1 ms). `c_node` is **12 µs on f1** (GADDAG, 1.2 µs × 10) and **18 µs on f0** (DAWG only:
f1 × 1.5, consistent with 1.9 µs × 10). Each cap is sized so that the worst case, with the cap reached, fits the
target.

| Personality | Artefact | `maxNodes` | `maxCandidates` | Worst case on device | Target |
|---|---|---|---|---|---|
| Strategist | f1 | 70,000 | 500 | 150 + 840 + 550 = 1,540 ms | AC-8 compute p95 ≤ 2 s |
| Strategist | f0 | 70,000 | 500 | 150 + 1,260 + 550 = 1,960 ms | same |
| Strategist | f1-only sizing on f0 (dropped) | 70,000 | 900 | 2,400 ms (**misses**) | — |
| Beginner | f1 / f0 | 70,000 | 300 | 1,290 / 1,710 ms | compute p95 ≤ 1 s (typical ≈ 0.2 s); worst case hidden under the 4 s total |

**Frozen value.** `BOT_VERSION` 2 freezes **Strategist 70,000 / 500 on every host and both automata**, with no
exception (game-designer review GD-7, 2026-10-04). The earlier 70,000 / 900 option for a locked f1 is dropped: P7
sets the f1 size gate at ≤ 215 B/form with a batch-3 ceiling of 2,550 forms and recommends sizing for f0 from the
start. A budget that is safe on f0 means a later f0 switch (lexicon P7 rule) needs no version bump. One budget per
version keeps server, simulator and device decisions identical whenever no cap binds (P-BOT-03). When a cap binds,
the DAWG and GADDAG paths may choose different moves, so goldens are pinned on the automaton the app ships (§5.6,
spec AC-12).

**Change rules:**

- Before B4 merges, the constants may be replaced once. The sources are Hermes-CLI constants (P3), or a Node
  re-measurement after the cheaper key build (§5.6 step 1).
- After B4 merges, **H1 device numbers trigger `BOT_VERSION` 3**. No other path changes a budget.

Typical batch-3 cost: synthetic 2,000 p95 is 4,118 / 4,273 nodes and 94 candidates, i.e. ≈ 0.30 s (f1) and
≈ 0.33 s (f0). The cap binds only on two-blank racks. The full derivation is in the Strategist spec (§ Budget).

## 7. Test obligations (B1)

| ID | Property | Kind |
|---|---|---|
| P-BOT-01 | For every reachable state `s` with a bot seat `p` on turn, `apply(s, chooseAction(observe(s, p), ctx).action)` is ok (incl. fallbacks, both automata, every personality, tiny budgets) | PBT + ≥ 1,000 full matches (B2) |
| P-BOT-02 | Determinism: same inputs ⇒ deep-equal decision; deep-frozen inputs untouched; decision invariant under hidden-information changes (other rack, bag order) | PBT |
| P-BOT-03 | Unbounded budgets: GADDAG and DAWG generation yield the same set of canonical keys; with finite budgets, equal decisions whenever neither path reports `budgetExhausted` | PBT (real index + synthetic) |
| P-BOT-04 | Soundness: every generated candidate is accepted by `evaluateMove`. Completeness: on a tiny synthetic lexicon, generated set ⊇ brute force over placements of ≤ 3 rack tiles | PBT |
| P-BOT-05 | `nodesUsed ≤ maxNodes`, `candidatesEvaluated ≤ maxCandidates`, `budgetExhausted` ⇔ a cap dropped work | PBT |
| P-BOT-06 | No candidate ⇒ `EXCHANGE` (whole rack minus blanks) iff `bagCount ≥ 7`, else `PASS`; never `RESIGN` | PBT + fixtures |
| P-BOT-07 | Beginner: main word ≤ intermediate whenever an evaluated candidate qualifies; never a voluntary exchange | PBT |
| P-BOT-08 | Error order of §3 on spectator/finished/off-turn/foreign-lexicon observations | unit |

Golden: 20 seeded positions × personality → expected canonical key. From `BOT_VERSION` 2 these are pinned per
(`BOT_VERSION`, `engineRulesVersion`) (§5.6). A change is intentional and reviewed. Bench (`vitest bench`): §6 tables, JSON artefact in CI (L6).

## 8. Consumers

| Consumer | Uses | Must not |
|---|---|---|
| B2 simulator | `observe` + `chooseAction` + `apply`; derives streams from the match seed; logs `nodesUsed`, `budgetExhausted` | hand bots a `MatchState` |
| `apps/mobile` (S1) | same, off the UI thread; think delay from `bots.think_delay_ms`; on resume re-derives the same stream (AC-11) | use wall clock to stop a bot; persist `Rng` state |
| `services/game` (Phase 2, ranked-practice bots) | same; ≤ 50 ms/move server budget ⇒ server-side personalities get their own budgets | expose decisions' internals to clients |

## 9. Open questions

- **O-1 — closed (L5 #47, B2):** `LexiconIndex.dawg` shipped; the DAWG fallback and P-BOT-03 are implemented
  (§4.3), Q-A2 measured (§6).
- **O-2 (game-designer):** confirm BOT-6/§5.3 step 6 (Beginner exchanges when it has no word, at any turn, but
  never voluntarily) as the reading of F-8; confirm BG-1..BG-5 as the B2 calibration targets.
- **O-3 (product-strategist, E-1.5 R-7):** remote-tunable bot config needs `PersonalityData` overrides in the
  context (not in this contract). Proposal: keep tuning in code (`BOT_VERSION`) for the playtest; revisit if
  the guardrail trips more than once.
- **O-4 (solution-architect):** confirm the §4.4 compact key as the reading of ADR-0013 §D4.7 "canonical action
  encoding" (same order as needed: total and deterministic; not byte-equal to JCS).

### 9.1 Orchestrator decisions (2026-10-03, reversible)

- **O-1:** folded into L5. The GADDAG task also exposes `LexiconIndex.dawg` (same arc shape minus the separator).
  B1 starts on the GADDAG path and adds the DAWG fallback and P-BOT-03 once L5 lands.
- **O-2:** provisionally accepted. A forced exchange when no word exists is not a strategic exchange, so it does
  not breach F-8. BG-1..BG-5 are the B2 targets. game-designer confirms or adjusts them in the B2 readout.
- **O-3:** proposal accepted. Tuning stays in code behind `BOT_VERSION` for the playtest. Remote overrides are
  revisited only if the human-win guardrail trips more than once.
- **O-4:** accepted. ADR-0013 §D4.7 requires a total, deterministic, documented order. It does not require byte
  equality with JCS. The compact key meets that bar, and `JSON.stringify` stays banned for comparisons.
