# Strategist bot

- Epic: E-1.3 (feeds E-1.5 slice S4, E-1.6 balance; depends on E-1.1, E-1.2, E-1.7 batch 3) · Vision refs: V-15 ·
  Status: **Draft, ready for review**. It becomes Ready for implementation once the `game-designer` review lands
  (open questions GD-1..GD-8).
- Owner: ai-engineer (spec author for this bot; E-1.3 owner) · Last update: 2026-10-04
- Sprint: `docs/sprints/2026-10-04-phase1-playtest-gates.md`, task **ST0**. It unblocks B4 (implementation and
  `BOT_VERSION` 2), S4 (opponent selector) and BC (the v2 `/balance-check` uses a Strategist mirror).
- Next reviews: `game-designer` (decision model, thresholds, ST-x targets: required), `product-strategist` (persona
  promise, guardrail), `data-analyst` (readout definitions; no new events), `mobile-engineer` (budget, S4),
  `lexicon-engineer` (P7 interplay). `privacy-compliance` is not needed: no personal data, no new event and no
  new field. `monetization-liveops` is not needed: no economy.
- Normative inputs. This spec never overrides them:
  - `docs/architecture/notes/bots-api.md`: contract §3, pipeline §4, personalities §5, budget §6, the new
    Strategist data §5.5 and `BOT_VERSION` 2 plan §5.6;
  - `docs/game/decisions/2026-10-b2-response.md` (D2, T-1, BG-2a/2b);
  - `docs/game/BALANCE.md` (B-07, C-02, C-05, C-10, C-11);
  - `docs/specs/E-1.5-play-vs-bot/classic-match-vs-bot.md` (AC-8, AC-9, AC-11, F-8, F-9, guardrails, flags);
  - `docs/game/GAME_RULES.md` v0.3.1 (R-TURN-001, R-TURN-004, R-SCORE-003..006).

## Problem

The playtest needs a second opponent. Its job is to give players who have beaten Beginner a reason to play again
(E-1.5 story 5, AC-9). The project also needs a stronger, more human-shaped bot as its **balance instrument**:
C-02, C-05, C-10, C-11 and B-01 are all defined on a Strategist mirror. Until now, greedy has stood in for it, and
b2-response §10 notes that every number measured with greedy must be re-read on Strategist.

Evidence:

- **Beginner v2 is a weak rung.** With `[16,6,2,1]`, full-vocabulary greedy beats it 96 % of the time (b2-response
  D2). A bot that only maximises points would clear B-07 easily. It would also crush casual players, and E-1.5
  F-9 sets their win rate against Strategist at 20–50 %.
- **Greedy does not play like a person.** It ignores its leave, never blocks, and only exchanges when forced.
  E-1.5 F-8 asks for personalities that differ by **behaviour**, not only strength.
- **The budget so far was a guess.** The 400,000-node provisional cap assumed `c_node` ≈ 0.1 µs. The B2
  measurement on Node is ≈ 1.2 µs (GADDAG) and ≈ 1.9 µs (DAWG), 10–20× higher (bots-api §6). No device number
  exists yet (H1 is blocked on hardware).

## Target players & context

- **Players:** playtesters who finished at least one match (AC-1 always starts them on Beginner). Mostly casual,
  tech-curious adults. At least a third are non-engineers (E-1.5 segment).
- **Device:** offline, on a mid-range or low-end Android (reference: Galaxy A0x class), Hermes, bot on the JS
  thread (sprint decision; P5 spike). The server and the simulator run the same code on Node.
- **Locale:** EN/FR. Bot copy already exists (`bot.strategist.name`, `bot.strategist.style`; E-1.5 design §5.3).

## Persona and player-facing promise

**Strategist** (FR *Stratège*). Angular avatar (E-1.5 design D-25). Always labelled as a bot.

Style line (existing copy, unchanged): *"Plans ahead, hunts bonuses and blocks big lanes."* /
*"Voit loin, chasse les bonus et bloque les grosses lignes."*

**The promise.** A real opponent that plays like a seasoned player. It is beatable with good play, but it never
hands you the game. A player who watches it should notice four behaviours, all visible in the move log and the
score breakdown:

| Behaviour (F-8) | What the player sees | Mechanism (§ Decision model) |
|---|---|---|
| Values its leave | It sometimes plays a smaller word and keeps good tiles; when it holds the blank, it rarely wastes it on a small play | Leave term `L` |
| Blocks open lanes when leading | When it is ahead, it closes or takes triple-word lanes instead of opening them | Denial term `D`, scaled by the score difference |
| Exchanges on a poor leave | "Strategist exchanged 4 tiles" now and then, early or mid-game, never in a stalled endgame | Exchange rule `X` |
| Favours chains | It links related terms (KUBERNETES → POD → CONTAINER) more often than chance would | Chain term `C` |

What it does **not** do:

- It does not see your rack or the bag order (BOT-2).
- It does not use powers (there are none in Classic for Phase 1).
- It never resigns.
- It does not play every expert term it could. Its vocabulary stops at **advanced** in the starting
  configuration (GD-1).

Strength target, in words: **clearly stronger than Beginner, and clearly weaker than a pure score maximiser with
full vocabulary.** The strategy should show in how it wins, not in how often.

## User stories

1. As a player who has beaten Beginner, I want an opponent that plays the game differently and better, so that
   winning feels earned and losing teaches me something about rack and board management.
2. As a player, I want the Strategist's moves to come within the same perceived pace as Beginner's (AC-8), so
   that the stronger bot never feels slower or frozen.
3. As game-designer, I want a deterministic, budget-bounded Strategist whose mirror is a credible stand-in for
   good human play, so that the B-01, C-05, C-10 and C-11 readouts and the v1/v2 decision rest on it.
4. As product-strategist, I want a kill switch and a human win-rate guardrail, so that a broken or badly
   calibrated Strategist can be hidden or retuned during the playtest without blocking play.

## Decision model (integer-only)

The pipeline is bots-api §4.1, unchanged: guards, cross-checks, generation under `maxNodes`, then the
personality's ranking, then the BOT-6 fallback. Only step 4 (rank and choose) and the fallback keep-set are
specific to Strategist.

Arithmetic rules (ADR-0013 §D4.1):

- Every quantity is an integer.
- Utility is in **tenths of a point ("dp")**, so 10 dp = 1 point.
- A weighted term `⌊x · w / 1000⌋` uses an integer floor division `floorDiv` (rounding toward −∞, also for negative
  `x`).
- Every parameter named below is a field of the Strategist's personality data (bots-api §5.5), shown with its
  **starting value**. B4 tunes these on tuning seeds only (§ Pre-registration).
- Letter values come from `getLetterTable` of the observation's rules version, so `letters-v2` is picked up
  without a code change.
- Scoring happens only through `evaluateMove` (BOT-9). The terms below rank candidates. They never change a score.

### S-1 Vocabulary and shortlist

1. **Vocabulary filter.** This is the Beginner §5.3 step 1 mechanism with `maxDifficultyRank` **2**: keep main
   words up to advanced. If that empties the set, the filter is ignored.
2. **Overflow shortlist.** This applies only when more than `maxCandidates` candidates remain. It uses no random
   draw and no letter values, so it is not a second scoring path. Order candidates by the **attention key**
   `A = 8 · tilesPlaced + 4 · (DW + TW squares newly covered) + (DL + TL squares newly covered)` descending, ties
   by canonical key (§4.4). Keep the first `maxCandidates`. Premium squares come from `getLayout`; this is board
   analysis (engine API Q10).
3. Evaluate every kept candidate with `evaluateMove` to get `breakdown`, `leave` and `goesOut`.

At batch-2/3 sizes, the shortlist almost never triggers: candidates p95 is 20–94 and the max is 292–527 (bots-api
§6 Q-A2). It exists to bound rare racks holding two blanks.

### S-2 Utility of a PLACE_WORD candidate

`U = 10 · breakdown.total + L + C + D`

Ties are broken by canonical key. Each term is defined below.

**L, the leave** (terms in dp; `v(t)` = letter value, 0 for a blank):

- `raw(K)` for a multiset `K` of rack tiles is the sum of three parts.
  - **Tile terms:** `tileDp(blank) = leaveBlankDp` (+150). For a letter,
    `tileDp(l) = max(leaveFloorDp, leaveBaseDp − leavePerValueDp · v(l)) + leaveLetterBonusDp[l]`. Starting
    values: base 20, per value 10, floor −60, bonus S +30, all other bonuses 0. With `letters-v1` this gives:
    E A I O N R T +10, S +40, C L P U 0, D M G H B −10, Y F −20, K W −30, V −40, X Q J Z −60.
  - **Vowel balance:** `n` = non-blank tiles in `K`, `w` = vowels among them (A E I O U). The ideal count is
    `ideal = floorDiv(n · vowelIdealPermille + 500, 1000)`, with `vowelIdealPermille` 350 (the bag is 34.7 %
    vowels). The term is `−vowelOffDp · |w − ideal|` (30). When `n ≥ 3` and `w = 0` or `w = n`, a further
    `−vowelAllOrNoneDp` applies (40).
  - **Duplicates:** for each letter held `k ≥ 2` times, `−duplicateDp · (k − 1)` (25). Blanks are exempt.
- **Bag weighting.** If `obs.bagCount ≥ 7`, then `L = raw(leave)`. If the bag holds 1–6 tiles, then
  `L = floorDiv(raw(leave) · leaveLowBagPermille, 1000)` (400).
- **Bag empty (endgame).** `L = −endgameRackDp · Σ v(leave)` (20 per point: the tiles left are deducted, and they
  count for the opponent if the opponent goes out, R-SCORE-006). If `goesOut`, add
  `+endgameRackDp · Σ v(unseen)` instead. With the bag empty, `obs.unseen` is exactly the opponent's rack, which
  is public information in the observation.

**C, chain preference** (only while `obs.bagCount ≥ 1`):

- `C = chainKeepDp · breakdown.chainKAfter + chainDegreeDp · min(degree(mainTerm), chainDegreeCap)`
- Starting values: `chainKeepDp` 25, `chainDegreeDp` 3, `chainDegreeCap` 8.
- `degree` is `ctx.lexicon.neighbours(term).length` for the main word's canonical term. Neighbours are in-profile
  only, the same graph R-SCORE-005 uses.
- The chain points of this move are already in `breakdown.total`. `C` values *keeping* a chain alive, which is
  worth `+5(k+1)` next turn if the next word links, and landing on a well-connected term.

**D, lane blocking and premium denial:**

- **Hot squares.** An empty TW or DW square is *hot* on a board when one of two conditions holds:
  - it is orthogonally adjacent to a tile;
  - a tile lies within `laneReach` (4) squares along its row or column, with only empty squares in between.
- **Exposure.** `exposure(board) = hotTwDp · #hot TW + hotDwDp · #hot DW`, with `hotTwDp` 60 and `hotDwDp` 20.
- **Mode.** Let `lead` = own team score − the best other team score, from `obs.teamScores`.
  - Leading (`lead ≥ leadThreshold`, 30): `denialLeadPermille` 1500. This is F-8's "blocks open TW lanes when
    leading".
  - Trailing (`lead ≤ −trailThreshold`, −50): `denialTrailPermille` 400. When behind, it accepts an open board.
  - Otherwise, and whenever the bag is empty: `denialEvenPermille` 1000.
- **Term.** `D = −floorDiv((exposure(after) − exposure(before)) · modePermille, 1000)`. Here `after` is a scratch
  copy of `obs.board` with the candidate's tiles placed. Covering a hot TW yourself lowers the exposure and scores
  positive. Opening one scores negative.
- This term is a cheap proxy: it ignores cross-check feasibility of the opened lane (GD-4). The cost is
  ≤ 24 premium squares × ≤ 8 steps per candidate, about 10 µs on Node.

### S-3 Choosing among PLACE_WORD candidates

Rank by `U` descending, ties by canonical key. Draw rank `i` with integer weights `topWeights` (starting value
**`[16, 6, 2, 1]`**), using one `ctx.rng.int(0, Σw)`. The best move is picked 64 % of the time.

There is no short-word multiplier and no missed Full Stack (`shortMultiplier` 1, `skipFullStackPermille` 0).

The draw happens **after** the exchange decision (S-4). It is the only random draw, so the decision is a function of
the `bot:<seat>:<n>` stream (BOT-1, AC-11).

### S-4 Exchange on a poor leave (voluntary)

Let `P*` be the candidate with the highest `U` (the argmax, before the weighted draw).

- **Best keep.** `K*` is the multiset `K ⊂ rack` with `|K| ≤ 6` that maximises `raw(K)`. Ties go to the larger
  `|K|`, then to the code-unit-smallest sorted tile string. There are at most 2⁷ = 128 subsets, which counts as
  fixed cost.
- **Rule.** Strategist plays `EXCHANGE(rack − K*)` instead of a word when **all** of these hold:

| # | Condition | Starting value | Why |
|---|---|---|---|
| X-1 | `obs.bagCount ≥ RULES.minBagForExchange` | 7 | R-TURN-001 |
| X-2 | `obs.scorelessTurns ≤ exchangeMaxScoreless` | 2 | Never pushes a stalled board toward an R-TURN-004 ending with ≥ 7 tiles in the bag (C-10; b2-response D1). The limit is 6 in 1v1 |
| X-3 | `P*.breakdown.total ≤ exchangeMaxScore` (points) | 14 | It only gives up a small play |
| X-4 | `raw(P*.leave) ≤ exchangePoorLeaveDp` | −80 | The leave really is poor |
| X-5 | `raw(K*) − raw(P*.leave) ≥ exchangeGainDp` | +150 | The exchange improves the rack by ≥ 15 points of leave value |

- **No word at all (BOT-6 path).** Strategist exchanges `rack − K*` if the bag holds ≥ 7 tiles, else it passes.
  This keeps the useful tiles, not only the blanks. It is a personality-specific refinement of BOT-6:
  P-BOT-06 for Strategist reads "an EXCHANGE of ≥ 1 tile iff `bagCount ≥ 7`", and it never resigns. The keep
  matters because the forced exchange is also what makes a stuck match terminate (b2-response §3.2).

### S-5 What Strategist never does

- It reads no `MatchState`, seed, bag order or opponent rack (BOT-2, lint).
- It never computes a score outside `evaluateMove`.
- It never reads a clock or wall time, and it never uses budget-free search: when a cap stops work, it returns
  the best result so far (BOT-4).
- It never voluntarily exchanges when X-2 fails, so there is no stalling.
- It never resigns.

## Budget (provisional, `BOT_VERSION` 2)

The bots-api §6 rule is `maxNodes = ⌊(T_target − T_fixed − maxCandidates × c_cand) / c_node⌋`, with
`T_target` = 2,000 ms, the AC-8 Strategist compute p95 on the reference device. The **cap is sized for the worst
case** (cap reached), so p95 sits far below it.

Device constants (provisional; Node measurement × a **Hermes factor of 10**, per the sprint decision):

| Constant | Value on device | Basis |
|---|---|---|
| `T_fixed` | 150 ms | bots-api §6 estimate kept as margin. Node measured 0.8–1.3 ms p95 × 10 = 8–13 ms. It also covers Strategist's fixed work (128-subset keep search, `exposure(before)`) |
| `c_cand` | 1.1 ms | `evaluateMove` Hermes budget 1 ms (engine API §18) + strategy terms ≈ 10 µs Node × 10 = 0.1 ms |
| `c_node`, **f1** (GADDAG section shipped) | **12 µs** | 1.2 µs Node (B2, two-blank runs, including candidate recording) × 10 |
| `c_node`, **f0** (DAWG only, lexicon P7 fallback) | **18 µs** | f1 × 1.5 (B2: DAWG ≈ 1.3–1.9× GADDAG time; Node DAWG 1.9 µs × 10 = 19 µs agrees) |

Budgets:

| Artefact | `maxNodes` | `maxCandidates` | Worst case on device (cap reached) | Typical p95 at batch 3 (estimate) |
|---|---|---|---|---|
| **f1** | **70,000** | **900** | 150 + 70,000 × 0.012 + 900 × 1.1 = 150 + 840 + 990 = **1,980 ms** | 4,118 nodes, 94 candidates: 150 + 49 + 103 ≈ **0.30 s** |
| **f0** | **70,000** | **500** | 150 + 70,000 × 0.018 + 500 × 1.1 = 150 + 1,260 + 550 = **1,960 ms** | 4,273 nodes, 94 candidates: 150 + 77 + 103 ≈ **0.33 s** |
| f0, alternative (rejected) | 47,000 | 900 | 150 + 846 + 990 = 1,986 ms | — |
| f1 budget on an f0 artefact (unsafe) | 70,000 | 900 | 150 + 1,260 + 990 = **2,400 ms**: misses AC-8 | — |

Derivation: f1 gives `⌊(2,000 − 150 − 900 × 1.1) / 0.012⌋ = 71,666`, rounded down to 70,000. f0 with the same
70,000 nodes gives `⌊(2,000 − 150 − 1,260) / 1.1⌋ = 536` candidates, rounded down to 500.

The f0 row keeps the node cap and cuts candidates rather than the reverse:

- Nodes decide how complete the move set is. At 2,000 synthetic forms, racks with two blanks need 44k nodes at
  p50 and 87k at p95.
- The candidate cap rarely binds, because candidates p95 is ≤ 94 at batch-3 size.

**Recommendation for the P7 reconciliation.** Freeze `BOT_VERSION` 2 at **70,000 / 500** on every host and both
automata. The other option is 70,000 / 900, and it is only worth taking if all of the following hold at B4 merge:

- P7 has decided that the playtest build ships **f1**;
- the restated size gate has headroom through batch 4;
- the 400 extra candidates measurably help (ST-2 or ST-1 on tuning seeds).

Reasons:

- A budget that is safe on f0 means a later switch to f0 needs **no** `BOT_VERSION` bump. The 900 budget on f0
  misses AC-8 (2.4 s worst case).
- A single budget per `BOT_VERSION` makes the server, simulator and device decide identically whenever no cap
  binds (P-BOT-03). Simulator readouts then describe the bot players actually face.

**Beginner under `BOT_VERSION` 2.** The same constants put Beginner's 200,000-node cap at
150 + 2,400 + 300 = 2.85 s worst case on f1 and 4.05 s on f0. That exceeds AC-8, even though Beginner's p95 is
about 2,500 nodes. Proposal: Beginner gets **70,000 / 300**, for a worst case of 1.29 s (f1) or 1.71 s (f0). BG-5 is
re-read: at batch 2 the Beginner maximum was ≈ 60,000 nodes, so the cut binds only on rare two-blank racks. This
amends the b2-response D2 note that the budget is unchanged (GD-7).

**Rules for changing the budget:**

1. **Before B4 merges**, the constants may be replaced once, by better evidence from either source:
   - the **Hermes-CLI constants from P3**, if they have landed;
   - B4's own Node re-measurement after the **cheaper key build** (in B4 scope: full canonical keys are built only
     for kept candidates, and dedupe uses a packed integer signature). That change lowers `c_node`, not node
     counts or decisions. It ships first under `BOT_VERSION` 1 with `decisions-v1.json` unchanged, to prove it is
     a pure refactor.

   B4 re-applies the formula and records the result here.
2. **After B4 merges**, the budget is frozen with `BOT_VERSION` 2. **Device numbers from H1 trigger
   `BOT_VERSION` 3**, which re-applies the formula with measured `T_fixed`, `c_node` and `c_cand`. No other path
   changes the budget, and wall-clock stopping stays banned (BOT-3).

Expected binding: at batch 3, the 70,000 cap binds only on two-blank racks, roughly in their upper half. Strategist
keeps blanks (`leaveBlankDp` +150), so two-blank racks are more common for it than for Beginner. ST-5 watches this
(risk R-3). Generation tries blanks after natural letters (§4.1), so an exhausted search still holds every
natural-letter move.

## ST-x simulator targets

Read on the **batch-3 lexicon as merged** (C3), on the automaton the playtest build ships (P7; both, if undecided),
with `engineRulesVersion` 1 and the v2 draft both reported. The gate is the version the build pins. Seats are
swapped. CIs are Wilson 95 %. Draws are excluded from win rates and reported. Matches are replay-verified.

| ID | Metric | Target | Sample | Lever if missed |
|---|---|---|---|---|
| **ST-1 (B-07, pre-registered)** | Strategist vs Beginner v2 (`[16,6,2,1]`), win rate | **lower 95 % CI ≥ 60 %** | 2,000 matches (1,000 seeds × 2 seat orders), confirmation seeds | `topWeights` sharper; `maxDifficultyRank` 3 |
| ST-1b | Same run: point estimate | **70–85 %** (human-guardrail proxy, see below) | as ST-1 | above 85 %: flatter `topWeights` and/or `maxDifficultyRank` 1→2 stays; below 70 %: sharper |
| ST-2 | Strategist vs **ablated Strategist** (same filter, weights and budget; `L = C = D = 0`, no voluntary exchange) | point ≥ 55 %, lower CI > 50 % | 2,000, paired | leave and denial weights (the strategy must add strength, not only flavour) |
| ST-3 | Full-vocabulary greedy vs Strategist | **reported, no target** (like BG-2b: the gap is deliberate) | 2,000 | — |
| ST-4a | Mean `raw(leave)` after Strategist's PLACE_WORDs with bag ≥ 7, minus greedy's | ≥ +30 dp | from ST-3 run | leave weights |
| ST-4b | Voluntary exchanges, share of Strategist turns with bag ≥ 7 | 1–6 %, and **0** with `scorelessTurns ≥ 3` | ST-1 + mirror | X-3..X-5 |
| ST-4c | Hot TW squares opened per Strategist move while leading, ÷ greedy's in the same score situation | ≤ 0.70 | ST-3 run | `hotTwDp`, `denialLeadPermille` |
| ST-4d | Share of Strategist main words that extend a chain (`chainKAfter > 0`), ÷ greedy's | ≥ 1.25 | ST-3 run | `chainKeepDp`, `chainDegreeDp` |
| ST-5 | `budgetExhausted`, share of Strategist decisions; node p95 | ≤ 1 %; node p95 ≤ 35,000 (half the cap) | every run | cheaper generation; R-3 |
| ST-6 | Legality and determinism: 100 % of actions accepted by `apply`; same seed ⇒ same log; replay hashes equal | 100 % over ≥ 1,000 matches | nightly `test:full`; ~250-match PR smoke | bug fix (blocking) |
| ST-7 | Mirror health, Strategist mirror vs greedy mirror on paired seeds: C-10 (premature lock) | Strategist ≤ greedy + 1.0 point, and ≤ 5 % absolute | 10,000 (BC run) | X-2, X-5 |

How ST-1b relates to the human guardrail (an assumption, recorded and reversible). Use a logistic (Elo-like) chain
from a playtester's assumed win rate against Beginner (60–75 %, i.e. at or above the ≥ 55 % F-9 target):

- Strategist at 85 % against Beginner puts human wins against Strategist at ≈ 21–35 %.
- Strategist at 70 % puts them at ≈ 39–56 %.

So 70–85 % in simulation is the band most likely to land inside the 20–50 % human guardrail. The playtest is the
real test.

### Pre-registration (ST-1 / B-07)

Written before any Strategist run, so the gate cannot be tuned against itself:

- **Hypothesis:** Strategist at `BOT_VERSION` 2 as merged beats Beginner v2 in ≥ 60 % of decisive matches.
- **Test:** Wilson 95 % lower bound ≥ 60.0 %. One-sided reading, draws excluded and reported.
- **Seeds:**
  - Confirmation: master seed `2026100400000b07`, stream `sim-match:<pairingIndex>:<i>`, pairing index 10,
    `i` in 0..999, each seed played in both seat orders.
  - Tuning (B4 only): master seed `2026100400000a00`, any pairing. Confirmation seeds are never used for tuning.
- **Pinned:**
  - `lexiconVersion` of batch 3;
  - `engineRulesVersion` 1 and the v2 draft (both reported; the build's version gates);
  - automaton per P7;
  - `BOT_VERSION` 2.
- **One confirmation run per candidate data set.** A failed run is reported, never deleted. Retuning produces a
  new candidate data set, tuned on tuning seeds only, and needs a new confirmation run under the same master seed,
  also reported.
- **Output:** results JSON and a digest committed next to the B4 PR (sprint rule: full runs leave PR CI).

## Human-win guardrail (playtest)

| Guardrail | Threshold | Reading rule | Action |
|---|---|---|---|
| Human win rate vs Strategist (E-1.5 F-9) | **20–50 %** | Read once there are ≥ 60 finished Strategist matches across ≥ 10 players, at most 10 counted per player. Wilson 95 % CI. Resigns count as losses, abandons are excluded | CI entirely below 20 % (too hard) or entirely above 50 % (too easy): retune by data under `BOT_VERSION` 3, levers in the order `topWeights` → `maxDifficultyRank` → denial weights. CI straddling a bound: hold and re-read at 2× the sample |
| Score margin vs Strategist (F-9, `score_margin`) | median loss margin ≤ 100 points | as above | same levers |
| Strategist compute | p95 > 4 s total on the reference device (E-1.5 guardrail) | `bot_word_played.think_ms` | kill switch, then `BOT_VERSION` 3 budget |

Tuning stays in code behind `BOT_VERSION` (bots-api O-3). Remote overrides are revisited only if this guardrail
trips more than once.

## Acceptance criteria

- **AC-1 Legal and authoritative.** Given any reachable Classic state with Strategist on turn, When the host calls
  `chooseAction(observe(s, seat), ctx)` with `personality: 'strategist'`, Then the returned action is accepted by
  `apply` (P-BOT-01) on both automata, at every budget down to `maxNodes = maxCandidates = 1`, and every point
  value it relied on came from `evaluateMove`.
- **AC-2 Determinism and resume.** Given the same observation, lexicon artefact, `bot:<seat>:<n>` stream,
  personality and budget, When `chooseAction` runs twice (or after a process kill, E-1.5 AC-11), Then the decisions
  are deep-equal. Given two states that differ only in hidden information (opponent rack, bag order), Then the
  decision is the same (P-BOT-02).
- **AC-3 Budget.** Given the `BOT_VERSION` 2 budget, When Strategist decides, Then `nodesUsed ≤ maxNodes`,
  `candidatesEvaluated ≤ maxCandidates`, and `budgetExhausted` holds iff a cap dropped work (P-BOT-05). Over the
  ST runs, ST-5 holds. On the reference device (H1), compute p95 ≤ 2 s. Until H1 runs, a Hermes-CLI estimate is
  reported as "not measured on device".
- **AC-4 Leave.** Given two evaluated candidates with equal `breakdown.total` whose leaves differ in `raw`, with
  `bagCount ≥ 7` and equal `C` and `D`, When Strategist ranks them, Then the better leave ranks first. Given the bag
  is empty and a candidate goes out, Then its utility includes `+endgameRackDp · Σ v(unseen)`.
- **AC-5 Exchange on a poor leave.** Given conditions X-1..X-5 hold, When Strategist decides, Then it plays
  `EXCHANGE(rack − K*)`. Given any of X-1..X-5 fails and a word exists, Then it plays a word. Given
  `scorelessTurns ≥ 3`, Then it never exchanges voluntarily. Given no word and `bagCount ≥ 7`, Then it exchanges
  `rack − K*` (≥ 1 tile). Given no word and `bagCount < 7`, Then it passes.
- **AC-6 Lane blocking.** Given Strategist leads by ≥ 30 and two candidates with equal `10 · total + L + C`, one of
  which makes a TW square hot, When it ranks them, Then the one that does not ranks first. Given it trails by ≥ 50,
  Then the denial weight is 400 ‰ (unit fixtures on hand-built boards).
- **AC-7 Chain preference.** Given two candidates with equal `10 · total + L + D`, one with `chainKAfter > 0`,
  When Strategist ranks them, Then the linked one ranks first.
- **AC-8 Ladder (B-07).** Given the pre-registered ST-1 run, When it completes, Then the lower 95 % CI is ≥ 60 %.
- **AC-9 Calibration and behaviour.** Given the ST runs, Then ST-1b, ST-2, ST-4a–d, ST-5, ST-6 and ST-7 meet their
  targets, or a miss is recorded with game-designer's sign-off before S4 enables the bot.
- **AC-10 Kill switch.** Given `bots.strategist.enabled` is off, When the opponent selector opens, Then Strategist
  is not offered for new matches. Given a match against Strategist is in progress, Then it can still be finished
  and resumed (E-1.5 AC-9). The bots package knows nothing about flags; the app reads the flag.
- **AC-11 Analytics.** Given a match against Strategist, When it starts, plays and ends, Then:
  - `bot_match_started` carries `bot_personality = strategist` and `bot_version = 2`;
  - `bot_word_played` with `actor = bot` carries `bonus_flags` including `chain` when it links;
  - `bot_match_finished` is emitted as for Beginner;
  - no new event or property is introduced.
- **AC-12 Goldens.** Given `BOT_VERSION` 2, Then 20 seeded positions per personality (Strategist included) are
  pinned per (`BOT_VERSION`, `engineRulesVersion`) in `packages/bots/test/golden/`. They are chosen so that no cap
  binds and the decision is identical on f1 and f0. Changing them requires a version bump.

## Non-goals

- Look-ahead search, opponent-rack inference from `unseen` (beyond the endgame), and simulation-based (Monte
  Carlo) leave values. These are Architect/Grandmaster levers (E-3.5).
- Powers, Arena or Blitz behaviour; server ranked-practice budgets (≤ 50 ms/move, Phase 2).
- Seeded think-time jitter: presentation, owned by the host (`bot-think:<seat>:<n>`, bots-api Q12); GD-8.
- Remote-tunable personality data (bots-api O-3).
- Any LLM in the decision path (never; Coach is `services/ai`).

## UX

No new screens. S4 (stretch) wires the existing selector (E-1.5 design §5.3) and resume card. Existing copy keys:
`bot.strategist.name`, `bot.strategist.style`, `match.bot_thinking`, and the move-log strings for exchanges. The
move log already shows "Strategist exchanged N tiles"; voluntary exchanges make that string visible for the first
time, so ux-ui-designer should confirm it reads as deliberate, not as a failure. No hard-coded strings.

## Rules impact

None. No rule ID is added or changed. Strategist uses R-TURN-001 (exchange threshold), R-TURN-004 (via X-2) and
R-SCORE-003..006 as written, reading them through `evaluateMove`, `RULES` and the observation.

## Analytics & KPIs

- **Events:** reuse the E-1.5 `bot_*` events unchanged: `bot_match_started`, `bot_match_finished`,
  `bot_match_abandoned`, `bot_match_resumed` and `bot_word_played`. Catalogue entry is SP1 (data-analyst).
- **Playtest readout (data-analyst), all derived from those events:**
  - human win rate vs Strategist;
  - `score_margin` (F-9);
  - Strategist pick share after match 1 (selector);
  - matches per tester vs Strategist;
  - bot `think_ms` p95;
  - share of bot words with the `chain` flag.
- **Simulator metrics** (no client events): ST-x, plus the T-1 metrics (bag-at-end split, tiles played,
  forced-pass tail, no-word turns with a non-empty bag).
- **Primary KPI** for S4: "would play again" among testers who played ≥ 1 Strategist match, compared with
  Beginner-only testers (directional, small n).

## Flags & rollout

| Flag | Default | Purpose |
|---|---|---|
| `bots.strategist.enabled` | **off until B4 passes AC-8/AC-9 and S4 lands; on in the playtest build** | Kill switch: hides Strategist for new matches; in-progress matches finish (E-1.5 AC-9) |

- **Kill triggers:**
  - any illegal action or non-determinism report;
  - compute p95 > 4 s total on the reference device;
  - a crash attributable to the bot;
  - human win-rate CI entirely below 10 % (crushing).

  Other guardrail misses are retuned (`BOT_VERSION` 3), not killed.
- **Rollout:**
  1. B4 merges with the flag off.
  2. S4 enables it in dev builds.
  3. Playtest Stage 0 (dogfood, sprint 4) runs with the flag on.
  4. Stage 1 runs with the flag on.

## Privacy, security, monetisation notes

- No personal data. The bot reads only its legal observation (BOT-2, ADR-0013 §D9).
- Nothing purchasable touches it.
- Integrity: a client-side bot cannot affect any ranked result (Phase 1 is casual and offline).

## Dependencies & risks

Dependencies:

- C3 batch 3, which the ST readings need;
- P7, which picks f1 or f0 and so the budget row;
- P3 (optional Hermes-CLI constants);
- B3 (simulator v2 support, needed for the v2 reading);
- E6 (v2 draft constants);
- H1 (device latency; later `BOT_VERSION` 3).

BC depends on B4 because Strategist is the balance instrument.

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-1 | **Too strong for casual humans** (guardrail < 20 %): full vocabulary plus leave management | Medium | High (playtest "would play again") | `maxDifficultyRank` 2 to start; ST-1b upper bound 85 %; guardrail with pre-set levers |
| R-2 | **Budget wrong on device** (×10 is a guess; Hermes may be slower) | Medium | High (AC-8) | Cap sized for the worst case; typical p95 ≈ 0.3 s leaves ≈ 6× headroom; Hermes-CLI constants before B4 merge; H1 ⇒ `BOT_VERSION` 3 |
| R-3 | **ST-5 miss on two-blank racks**: Strategist keeps blanks, and the 70k cap binds on part of two-blank positions | Medium | Low–Medium | Blanks generated last, so best-so-far holds all natural-letter moves; cheaper key build; if ST-5 misses only through two-blank racks, game-designer may accept a reported 1–2 % rather than lowering `leaveBlankDp` |
| R-4 | **Voluntary exchanges distort the balance mirror** (C-10, C-11 read on a Strategist mirror) | Low–Medium | High (v1/v2 decision) | X-2 scoreless guard; ST-7 paired against greedy; ST-4b cap 6 % |
| R-5 | **Heuristics bias B-01**: denial-when-leading may favour whoever leads early (often the first player) | Low | Medium | BC reports B-01 on Strategist and greedy mirrors side by side; a gap > 1 point is flagged to game-designer |
| R-6 | **Proxy lexicon**: tuning on batch-3 proxy forms, which have no morphology or relations, mis-sets chain/S weights | Medium | Low | Tune on the merged batch 3 only; ST-4d needs real relations |
| R-7 | **f0 switch after B4** with a 900-candidate budget breaks AC-8 | Low (if recommendation taken) | Medium | Freeze 70,000 / 500 unless P7 locks f1 |
| R-8 | **Schedule**: B4 is on a parallel critical path of similar length to C3 → BC | Medium | High (D0+9) | If Strategist is late, BC uses greedy (b2-response D4 allows it) and records the risk; the playtest ships v1 per §9.1 |

## Open questions

For **game-designer** (blocking Ready for implementation):

- **GD-1** Vocabulary cap: Strategist starts at `maxDifficultyRank` 2 (no expert main words unless nothing else
  exists). Is that consistent with "hunts bonuses"? The alternative is `maxDifficultyRank` 3 with flatter
  `topWeights`.
- **GD-2** Is ST-1b's 70–85 % band, the logistic proxy for the 20–50 % human guardrail, acceptable as a
  calibration target? Or should ST-1 stay lower-bound only?
- **GD-3** Exchange thresholds X-2..X-5 (scoreless ≤ 2, score ≤ 14, leave ≤ −80 dp, gain ≥ +150 dp), and keeping
  `K*` on the forced (no-word) exchange, which refines BOT-6's "whole rack minus blanks" for Strategist.
- **GD-4** Lane definition: TW and DW only, reach 4, no cross-check feasibility; lead ≥ 30 / trail ≤ −50 points.
  Should "hot" require at least one rack-independent playable extension? That would cost more per candidate.
- **GD-5** Leave table: blank +150 dp, S +40 dp in total; vowel ideal 35 %. Re-derive these after `letters-v2`
  (L7)? Formula-based values follow the table automatically; the S bonus does not.
- **GD-6** Chain weights (2.5 points per kept link, up to 2.4 points of graph degree): enough for ST-4d ≥ 1.25×
  to read as a behaviour, without overriding score?
- **GD-7** Beginner budget 200,000 → 70,000 nodes in `BOT_VERSION` 2, for device latency. This amends D2's
  "budget unchanged"; BG-5 is re-read.
- **GD-8** Think-time distribution for Strategist (F-8 "Beginner slower and more variable"): propose 1.2–3.0 s
  for Strategist vs 1.2–4.0 s for Beginner, inside `bots.think_delay_ms`. This is presentation, to settle with
  ux-ui-designer and mobile-engineer.

Assumptions (reversible):

- ASSUMPTION: Hermes ≈ 10× Node per node and per `evaluateMove` call, until P3 or H1 measure it.
- ASSUMPTION: playtesters beat Beginner 60–75 % of the time (basis of ST-1b).
- ASSUMPTION: two-blank racks are ≤ 3 % of Strategist decisions at batch 3 (basis of ST-5 ≤ 1 %); B4 measures it.

## Test traceability

| AC | Test(s) |
|---|---|
| AC-1 | P-BOT-01 extended to `strategist` (PBT + ≥ 1,000 full matches, both automata, tiny budgets) |
| AC-2 | P-BOT-02 for `strategist`; resume test in S3/S4 (same stream ⇒ same move) |
| AC-3 | P-BOT-05; ST-5 readout; `vitest bench` node/latency JSON; H1 device run or Hermes-CLI report |
| AC-4 | Unit fixtures on `raw`, `floorDiv`, endgame term; PBT: `U` monotone in `raw(leave)` at equal other terms |
| AC-5 | Unit fixtures X-1..X-5; PBT: no voluntary EXCHANGE when `scorelessTurns ≥ 3` or `bagCount < 7`; P-BOT-06 (Strategist reading) |
| AC-6 | Hand-built board fixtures (lead/even/trail); PBT: `exposure` is a pure function of the board |
| AC-7 | Fixture on a synthetic lexicon with known relations |
| AC-8 | Pre-registered ST-1 run (results JSON + digest) |
| AC-9 | ST readout script (B3) |
| AC-10 | E-1.5 AC-9 component and flag tests (S4) |
| AC-11 | E-1.5 analytics contract tests (`bot_personality`, `bot_version`) |
| AC-12 | Golden test per (`BOT_VERSION`, `engineRulesVersion`); f1/f0 equality on golden positions |
