# Design note — `@codelex/bots` public API and the Beginner bot (E-1.3)

- Status: Proposed · Date: 2026-10-03 · Owner/author: ai-engineer (contract proposed by solution-architect;
  Beginner design with game-designer reasoning, decisions delegated by the product owner)
- Reviewed-by: pending solution-architect, game-designer, lexicon-engineer (§4.3 DAWG accessor)
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
LLM anything (`services/ai` Coach; never in the gameplay path), Strategist (next sprint; §6 only fixes its budget).

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
export type BotPersonalityId = 'random-legal' | 'beginner' | 'greedy';   // 'strategist' added next sprint

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

### 4.3 DAWG fallback (needs one index member)
Appel–Jacobson: for each anchor, enumerate left parts up to the anchor's free-square limit, then extend right.
`LexiconIndex` does not expose the DAWG today (only `has`/`lookup`/`crossCheck`/`gaddag`). **Request to
lexicon-engineer (L5):** add `readonly dawg: Dawg` with `root`, `arcs(node)` (bits 0..25), `next(node, letter)`,
`isFinal(node)`, i.e. the `Gaddag` shape without the separator, over the mandatory DAWG section (zero size cost).
Until then B1 implements and tests the GADDAG path and the DAWG path against the reference index (L3).

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
| Strategist (provisional) | 400,000 | 800 | 150 + 800 + 800 = **1.75 s** | AC-8 p95 ≤ 2 s |

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

Golden: 20 seeded positions × personality → expected canonical key, pinned per `BOT_VERSION` (a change is
intentional and reviewed). Bench (`vitest bench`): §6 tables, JSON artefact in CI (L6).

## 8. Consumers

| Consumer | Uses | Must not |
|---|---|---|
| B2 simulator | `observe` + `chooseAction` + `apply`; derives streams from the match seed; logs `nodesUsed`, `budgetExhausted` | hand bots a `MatchState` |
| `apps/mobile` (S1) | same, off the UI thread; think delay from `bots.think_delay_ms`; on resume re-derives the same stream (AC-11) | use wall clock to stop a bot; persist `Rng` state |
| `services/game` (Phase 2, ranked-practice bots) | same; ≤ 50 ms/move server budget ⇒ server-side personalities get their own budgets | expose decisions' internals to clients |

## 9. Open questions

- **O-1 (lexicon-engineer, L5):** add `LexiconIndex.dawg` (§4.3). Without it the DAWG fallback cannot be built
  and P-BOT-03 cannot run; B1 is blocked on that half only.
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
