# Balance Targets & Simulation Protocol

Owner: `game-designer`. Used by `/balance-check`.

## Invariants (blocking)
| ID | Invariant | Target |
|---|---|---|
| B-01 | First-player win rate, Classic 1v1, equal bots | ≤ 52% |
| B-02 | Power usage → win-rate lift at equal rating | ≤ 5 points per power |
| B-03 | Arena max single-turn damage | ≤ 40% max HP |
| B-04 | Arena median match length | 4–8 minutes (human-paced sim) |
| B-05 | Blitz 60 s: median think time of Speedster bot calibrated to humans | ≥ 3 s |
| B-06 | Score variance between seats in 2v2 | not significantly different (p > 0.05) |
| B-07 | Bot ladder monotonic: each personality beats the previous ≥ 60% | Beginner < Strategist < Architect < Grandmaster |

## Letter values & distribution derivation (R-BAG-001)

Status: **v0.3 procedure** (replaces the v0.2 sketch; closes A-01 and, on the game-design side, lexicon-index
Q-G4). The derivation is an **offline** tool run by `game-designer`; its output is frozen per `engineRulesVersion`
(ADR-0013) and the engine only reads the frozen table. Lexicon releases never change the table.

1. **Corpus.** All playable forms of the global ranked profile, each form counted **once** (unweighted: the schema
   has no term-frequency class, so v0.2's "weighted by term frequency class" is dropped). Curated inflected forms
   (E-1.7) are forms and count once each, exactly like canonical forms (E-1.7 D-17, confirmed C-GD-4): they are
   what players and bots actually place, and plurals will raise S. The `letters-v1` corpus had no inflections.
2. **Frequency.** `f(l)` = occurrences of letter `l` / total letters in the corpus.
3. **Counts.** `n(l) = max(1, ⌊98 · f(l)⌋)`, then distribute the remaining tiles up to 98 by **largest remainder**
   of `98 · f(l)` (ties: alphabetical); letters with `98 · f(l) < 1` keep the single tile of the `max(1, ·)` floor and take no remainder. 2 blanks → 100.
4. **Values.** `v(l) = clamp(1, 10, round(k / f(l)^0.75))` with `k = 1.49 · f_min^0.75`, where `f_min` is the
   smallest `f` among E, A, I, O, N, R, S, T (so those eight are 1). The exponent is **0.75** (v0.2: 0.5): with
   0.5 the table collapses to a 1–8 range with a mean of 1.64 per tile, which undervalues the rare consonants
   (Q6, J6) and makes the fixed term bonus (+4/+8/+16) weigh more than intended; 0.75 keeps the mean lettered-tile
   value (≈ 2.0) aligned with the scale the term bonus was set against.
5. **Playability adjustments** (each one listed in the derivation record; anything else needs a new review):
   - (a) *anti-singleton:* a letter with `98 · f(l) ≥ 1.5` gets ≥ 2 tiles (one-tile letters create rack-luck
     swings); the tile is taken, among letters rounded up in step 3, from the one with the highest count (smallest
     relative distortion);
   - (b) *vowel cap:* vowel values ≤ 2 (vowels stay cheap and readable at a glance);
   - (c) *top cap:* 10 is reserved for the single rarest letter; other letters cap at 8 (three 10-point tiles in a
     98-letter bag make a single draw decide too many games);
   - (d) *monotonic:* a rarer letter never has a lower value than a more frequent one;
   - (e) *no vowel boost:* vowels are **not** raised towards general-English levels (≈ 42 %): the playable
     vocabulary is acronym- and consonant-heavy, and matching it maximises formable words (evidence below).
6. **Freeze.** The result is a constant table of the `engineRulesVersion`, snapshot-tested (GC-BAG-02).
7. **Re-derivation trigger.** Re-run when the lexicon reaches ≥ 2,000 playable forms (E-1.6 calibration) and then
   at most once per season; a changed table ships as a new `engineRulesVersion` after `/balance-check`
   (paired seeds, both tables). Per-profile or per-locale tables are out of scope until pillar 4 data says
   otherwise (A-12).

### Derivation record — `letters-v1` (`engineRulesVersion` 1)

Corpus: `packages/lexicon/data` at commit `9ab12ff` (2026-10-02), 310 playable forms, 2,007 letters, unweighted.
Throwaway script, not committed (re-implementable from steps 1–5).

| | E | R | A | T | O | I | N | S | C | L | P | U | D | M | G | H | B | Y | F | K | W | V | X | Q | J | Z |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| occurrences | 186 | 176 | 167 | 160 | 152 | 145 | 131 | 129 | 102 | 93 | 77 | 58 | 57 | 54 | 53 | 51 | 46 | 32 | 30 | 29 | 25 | 21 | 12 | 9 | 8 | 4 |
| f (%) | 9.27 | 8.77 | 8.32 | 7.97 | 7.57 | 7.22 | 6.53 | 6.43 | 5.08 | 4.63 | 3.84 | 2.89 | 2.84 | 2.69 | 2.64 | 2.54 | 2.29 | 1.59 | 1.49 | 1.44 | 1.25 | 1.05 | 0.60 | 0.45 | 0.40 | 0.20 |
| counts (step 3) | 9 | 9 | 8 | 8 | 7 | 7 | 6 | 6 | 5 | 4 | 4 | 3 | 3 | 3 | 3 | 2 | 2 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| **counts v1** | 9 | **8** | 8 | 8 | 7 | 7 | 6 | 6 | 5 | 4 | 4 | 3 | 3 | 3 | 3 | 2 | 2 | **2** | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| values, exp 0.5 (v0.2 formula) | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 2 | 3 | 3 | 3 | 3 | 4 | 5 | 6 | 6 | 8 |
| values, exp 0.75 (step 4) | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 2 | 2 | 2 | 3 | 3 | 3 | 3 | 3 | 3 | 4 | 4 | 5 | 5 | 6 | 9 | 10 | 10 | 10 |
| **values v1** | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 2 | 2 | 2 | **2** | 3 | 3 | 3 | 3 | 3 | 4 | 4 | 5 | 5 | 6 | **8** | **8** | **8** | 10 |

Adjustments applied: (a) Y 1 → 2 tiles (`98 · f = 1.56`), taken from R (9 → 8, `98 · f = 8.59`: the highest count
among rounded-up letters); (b) U 3 → 2; (c) X 9 → 8, Q 10 → 8, J 10 → 8 (Z, the single rarest letter with 4 occurrences,
keeps 10). Result: 100 tiles, 34 vowels (34.7 %), lettered value sum 192 (mean 1.96; the retired
default values on the same counts: 189 / 1.93), value range 1–10, monotonic.

**Evidence (rack formability, indicative).** 20,000 seeded random 7-tile racks per bag (2 blanks as wildcards),
share of racks that can form at least one playable form of the current lexicon **from the rack alone** (no board):

| Bag | Vowels | Any form | ≥ 3 letters | ≥ 4 letters |
|---|---|---|---|---|
| `letters-v1` (lexicon-matched) | 34 | **77.0 %** | **62.7 %** | **26.7 %** |
| v1 with 5 more vowels (general-English-like smoothing) | 39 | 76.1 % | 59.8 % | 26.6 % |
| classic English-word-game distribution | 42 | 71.4 % | 53.4 % | 20.6 % |

The lexicon-matched bag is best on every measure; raising vowels costs formability. This is not a substitute
for the E-1.6 simulation (no board, no hooks, thin 310-form lexicon).

### Derivation record — `letters-v2` (`engineRulesVersion` 2, DRAFT; sprint 3 task L7, T-4a)

Status: **draft** table of the v2 draft (ADR-0014 §D4). Frozen only by rules PR 0.4 (R4), and only if the v2
`/balance-check` (`docs/specs/E-1.6-balance/v2-balance-check.md`) picks v2.

- **Method:** steps 1–5 above, unchanged, implemented by the committed tool `tools/letters/derive.mjs` (no
  throwaway script this time). Reproduce: `node tools/letters/derive.mjs` (table) or `--json` (full record) at the
  input commit. Tests (`tools/letters/derive.test.mjs`, run by `pnpm validate`) check that the same code reproduces
  the frozen `letters-v1` table and its five recorded adjustments from the v1 occurrences above, and that it
  reproduces this table from its input lexicon.
- **Input:** `packages/lexicon/data` at `main` commit `b3ab7bb` (batch 3, #62; validator: 0 errors), the same
  lexicon commit the pre-registration §4.3 requires. **`lexiconVersion` `e568477b5592a994`**, profile
  `global-ranked` (`definitionHash` `da1f36a3747e0dfe`) with inflections: **2,154 distinct playable forms**
  (1,432 canonical + 722 inflections), **14,745 letters**, unweighted. `f_min` = N 5.54 %, `k` = 0.170165.
- **Rounding conventions** (implicit in v1, now explicit in code): `round` is half-up; the step-5a donor is the
  rounded-up letter with the highest count (ties: larger `98 · f`, then A–Z); in 5c a tie for the rarest letter
  leaves no letter at 10; in 5d a vowel capped by 5b is exempt and listed (none here).

| | E | S | A | T | R | O | I | N | C | L | P | D | M | U | G | B | H | K | F | Y | W | V | X | J | Z | Q |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| occurrences | 1540 | 1459 | 1176 | 1140 | 1103 | 1051 | 963 | 817 | 716 | 631 | 581 | 565 | 449 | 417 | 404 | 324 | 321 | 251 | 224 | 164 | 146 | 128 | 70 | 43 | 34 | 28 |
| f (%) | 10.44 | 9.89 | 7.98 | 7.73 | 7.48 | 7.13 | 6.53 | 5.54 | 4.86 | 4.28 | 3.94 | 3.83 | 3.05 | 2.83 | 2.74 | 2.20 | 2.18 | 1.70 | 1.52 | 1.11 | 0.99 | 0.87 | 0.47 | 0.29 | 0.23 | 0.19 |
| 98 · f | 10.24 | 9.70 | 7.82 | 7.58 | 7.33 | 6.99 | 6.40 | 5.43 | 4.76 | 4.19 | 3.86 | 3.76 | 2.98 | 2.77 | 2.69 | 2.15 | 2.13 | 1.67 | 1.49 | 1.09 | 0.97 | 0.85 | 0.47 | 0.29 | 0.23 | 0.19 |
| counts (step 3) | 10 | 10 | 8 | 7 | 7 | 7 | 6 | 5 | 5 | 4 | 4 | 4 | 3 | 3 | 2 | 2 | 2 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| **counts v2** | 10 | **9** | 8 | 7 | 7 | 7 | 6 | 5 | 5 | 4 | 4 | 4 | 3 | 3 | 2 | 2 | 2 | **2** | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| values (step 4) | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 2 | 2 | 2 | 2 | 2 | 2 | 3 | 3 | 3 | 4 | 4 | 5 | 5 | 6 | 9 | 10 | 10 | 10 |
| **values v2** | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 2 | 2 | 2 | 2 | 2 | 2 | 3 | 3 | 3 | 4 | 4 | 5 | 5 | 6 | **8** | **8** | **8** | 10 |

Adjustments applied (all procedural, from steps 5a–5d; **no manual adjustment**): (a) K 1 → 2 tiles
(`98 · f = 1.67`), taken from S (10 → 9, `98 · f = 9.70`: the highest count among rounded-up letters); (b) none
(U's raw value is 2); (c) X 9 → 8, J 10 → 8, Z 10 → 8 (Q, the single rarest letter with 28 occurrences, keeps 10);
(d) none needed. Result: **100 tiles** (98 + 2 blanks, value 0), 34 vowels (34.7 %), lettered value sum 185 (mean
1.89), range 1–10, monotonic.

Compact form (A–Z): values `A1 B3 C2 D2 E1 F4 G3 H3 I1 J8 K4 L2 M2 N1 O1 P2 Q10 R1 S1 T1 U2 V6 W5 X8 Y5 Z8`;
tiles `A8 B2 C5 D4 E10 F1 G2 H2 I6 J1 K2 L4 M3 N5 O7 P4 Q1 R7 S9 T7 U3 V1 W1 X1 Y1 Z1`.

Changes vs `letters-v1` (same procedure, bigger corpus with inflections): values D 3 → 2, M 3 → 2, K 5 → 4,
Y 4 → 5, Z 10 → 8, Q 8 → 10; tiles E +1, S +3, D +1, K +1, N −1, I −1, R −1, T −1, G −1, Y −1. Plurals raise S
(as predicted in step 1); Q replaces Z as the single 10.

**Sensitivity (reported, not adjusted):** F sits at `98 · f = 1.489`, 0.011 under the 5a threshold (1 tile; 3
more F occurrences in the corpus would give it a second tile, taken from S). G (raw 2.53 → 3) and U (raw
2.47 → 2) are within 0.05 of a rounding boundary. Any later lexicon commit can move them; that is why the table is
pinned to its input `lexiconVersion` and frozen per `engineRulesVersion`.

**`lexiconVersion` effect (sprint acceptance criterion):**

1. *Input pinning.* `letters-v2` is a function of `lexiconVersion` `e568477b5592a994` only. A later lexicon
   release never changes it (R-BAG-001: tables are frozen per `engineRulesVersion`, never per `lexiconVersion`;
   P-BAG-001-d). While v2 is a draft, re-deriving from a newer lexicon is allowed only before the v2
   `/balance-check` run, and only from the commit its §4.3 names; after the run it needs a new pre-registration.
2. *No lexicon change.* L7 changes no term, no `gameValue`, no `.clxi` and no `contentFormat`:
   `pnpm lexicon:validate` reports the same `lexiconVersion` `e568477b5592a994` before and after.
3. *`gameValue` decoupled (T-6, ADR-0014 §D5).* `gameValue` keeps its LEXICON_SPEC §4 formula and the frozen
   lexicon constants (`letters-v1` letter values, 0/4/8/16 bonus). Under `engineRulesVersion` 2 the in-game
   numbers come from `letters-v2` and the v2 term bonus, so `gameValue` and the in-game score of a term differ
   (KUBERNETES: `gameValue` 43; in a v2 match its letters sum 16 instead of 17 before premiums, plus +8 or +12).
   UI copy for in-match numbers reads the engine values (T-8).
4. *Matches and replays.* A match pins both `lexiconVersion` and `engineRulesVersion`; the pair, not the
   lexicon alone, determines the bag. v1 matches and goldens are unaffected (`rulesDigest(1)` and GC-DET-01
   unchanged).

## Classic `classic-v1` / `letters-v1` calibration targets (E-1.6; non-blocking)

No `/balance-check` is possible yet (no engine). E-1.6 validates `classic-v1` + `letters-v1` on the ≥ 2,000-form
lexicon with the protocol below (Strategist mirror unless stated). Invariants B-01..B-07 stay blocking; the targets
below are design targets: a miss triggers a layout/table review, not an automatic block.

| ID | Metric | Target | Lever if missed |
|---|---|---|---|
| C-01 | Rack-only formability (any playable form), as above | ≥ 75 % | counts (step 5a/e), lexicon short forms |
| C-02 | Turns where the bot finds no legal PlaceWord, *(v0.4)* counted over turns taken while the bag is not empty (the all-turns rate is reported next to it but is not the target: every R-TURN-004 ending adds a tail of ≈ 5 forced turns at batch-2/3 lexicon sizes, decision note `docs/game/decisions/2026-10-b2-response.md` D1) | ≤ 15 % | counts; lexicon short forms; 11×11 fallback rule below |
| C-03 | Mean points per accepted PlaceWord | 15–30 | value exponent (step 4) |
| C-04 | Premium share: Σ(turn score − same turn on a plain board) / Σ turn scores | 20–40 % | layout density |
| C-05 | Term-bonus share of all points | ≤ 35 % | value exponent; term bonus constants |
| C-06 | Plays with a word multiplier ≥ ×4 | ≤ 1 per 10 matches | layout spans (§2.1) |
| C-07 | Stuck letters: per letter, share of matches ending with it in a rack, ÷ mean over letters | ≤ 2.0 for every letter | that letter's count/value |
| C-08 | First-mover mean score lead (B-01 companion), start DW vs plain start (R-BOARD-004 variant) | ≤ 8 points | start-square premium |
| C-09 | **Hook re-scoring tripwire** (E-1.7 R-3, C-GD-2): term-bonus points earned by cross-words formed by adding exactly one tile to an existing word whose canonical term is unchanged (e.g. POD → PODS), ÷ all term-bonus points. Measured from E-1.7 batch 1 in the simulator, then in the playtest | ≤ 10 % | pre-decided fallback in R-SCORE-003 (no term bonus when a word is extended into an inflection of the same term), new `engineRulesVersion` |
| C-10 | *(v0.4)* **Premature lock-up:** matches ending on R-TURN-004 while the bag still holds ≥ 7 tiles (tiles that could still have been exchanged into play), ÷ all matches. This, not the raw share of R-TURN-004 endings, is the lock-up signal: R-TURN-004 is the normal ending whenever nobody goes out (55–67 % of matches even on a 60,000-word English lexicon) | ≤ 5 % | lexicon short forms and hooks (batch content); 11×11 fallback rule below |
| C-11 | *(v0.4)* Mean tiles played on the board per 1v1 match (of 100) | ≥ 90 | as C-10 |

## Simulation protocol
- ≥ 10,000 games per variant, identical seed sets for baseline and variant, seats swapped half the time.
- Report mean ± 95% CI; use paired comparisons on shared seeds.
- Simulation outputs saved to `packages/game-engine/sim-results/<date>-<variant>.json` (gitignored except summaries).

## Board-size fallback (product owner decision, 2026-10-02)
An 11×11 "Quick Classic" variant (~60-tile bag) is simulated alongside 15×15 and may ship behind a flag for the
E-1.5 playtest **only if** the 15×15 simulation shows any of: > 10 % of games ending on scoreless turns
(R-TURN-004), > 15 % of turns with no legal word, or the 20 most-played terms making up > 40 % of words played.
It is never used for ranked play.

*Measurement note (game-designer, 2026-10-04; the rule above is unchanged and stays a product-owner decision).*
The first trigger cannot separate a thin lexicon from a healthy one: in simulation, R-TURN-004 ends 99.6 % of
matches on the batch-2 lexicon, ≈ 94–98 % on a batch-3 proxy and still 55–67 % on a 60,000-word English lexicon,
because a scoreless ending is the normal ending whenever nobody goes out. A restatement ("> 10 % of games ending on
R-TURN-004 with ≥ 7 tiles in the bag", i.e. C-10, and/or C-11 < 90 tiles) is **proposed to the product owner** in
`docs/game/decisions/2026-10-b2-response.md` D1. Until the product owner decides, the trigger is read literally.

## Changelog
- 0.5 — 2026-10-04 — `game-designer` (sprint 3 task L7, T-4a/T-6): derivation record for the draft `letters-v2`
  (batch 3, `lexiconVersion` e568477b5592a994) with the committed tool `tools/letters/derive.mjs`; implicit
  tie and rounding conventions made explicit; `lexiconVersion` effect and `gameValue` decoupling (ADR-0014 §D5)
  documented. Procedure steps 1–7, invariants and targets unchanged.
- 0.4 — 2026-10-04 — `game-designer` (B2 follow-up, decision note `docs/game/decisions/2026-10-b2-response.md`,
  evidence `docs/game/sim/2026-10-b2-response/`): C-02 measured over turns with a non-empty bag (all-turns rate
  still reported); new C-10 (premature lock-up ≤ 5 %) and C-11 (tiles played ≥ 90); measurement note on the
  11×11 trigger (restatement proposed to the product owner, rule unchanged). Invariants B-01..B-07 unchanged.
- 0.3 — 2026-10-02 — `game-designer` (sprint D3, product-owner delegation): derivation procedure made
  explicit (unweighted corpus, largest remainder, exponent 0.75, listed playability adjustments, frozen per
  `engineRulesVersion`, re-derived at ≥ 2,000 forms); derivation record and evidence for `letters-v1`;
  calibration targets C-01..C-08 for E-1.6; C-09 hook re-scoring tripwire and inflections counted in the next
  derivation (E-1.7 C-GD-2, C-GD-4). Invariants B-01..B-07 unchanged.
- 0.2 — 2026-10-02 — Added the measured 11×11 fallback rule (product owner decision). Invariants unchanged.
- 0.1 — Initial targets.
