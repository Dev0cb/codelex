# B2 response — board lock-up, Beginner calibration, term-bonus weight, first-player advantage

- Date: 2026-10-04 · Author: `game-designer` (decisions under product-owner delegation, except where marked
  **PO**) · Responds to `docs/game/sim/2026-10-b2-readout.md` (PR #51, merged)
- Evidence: `docs/game/sim/2026-10-b2-response/` (`results.json`: 92 runs, 458,000 simulated matches;
  `jobs.tsv`: the exact spec of every run; `harness.mjs`; `patch-engine-dist.py`)
- Rules baseline: GAME_RULES 0.3.1, `engineRulesVersion` 1, `classic-v1`, `letters-v1`, `BOT_VERSION` 1.
  **No engine source, GAME_RULES or bot data was changed.** BALANCE.md 0.4 is updated (§7).

## 0. Decisions at a glance

| # | Question | Decision | Reversibility |
|---|---|---|---|
| D1 | Board lock-up: lexicon or rules? | **Lexicon thinness.** No rules variant moves any outcome (going-out count identical, 43 of 10,000, under every scoreless-limit variant). R-TURN-004 stays as is; **exchanges keep counting** (without that, 10.7 % of matches never end). The "scoreless ending ≤ 10 %" guardrail measures the wrong thing; BALANCE gets C-10 (premature lock ≤ 5 %) and C-11 (tiles played ≥ 90). Restating the 11×11 trigger is a **PO** decision. | Two-way (docs only) |
| D2 | Beginner | Keep the vocabulary persona (`maxDifficultyRank` 1). **Propose `topWeights` [8,5,3,2,1] → [16,6,2,1]** (`BOT_VERSION` 2, ai-engineer). Split BG-2 into BG-2a (vocabulary-matched greedy vs Beginner, 65–85 %) and BG-2b (full-vocabulary greedy, reported only). BG-1 and BG-4 unchanged, final reading at batch 3. | Two-way (bot data + version bump) |
| D3 | C-05 term-bonus weight | **Yes, but not in `engineRulesVersion` 1 and never alone.** Candidate for `engineRulesVersion` 2: novice 0 / intermediate +2 / advanced +4 / expert +8, together with the plain start (D4). Cutting the bonus on its own makes B-01 worse. Term bonus on the main word only: rejected. | One-way per version once logs are published; free until then |
| D4 | B-01 first-player advantage | **Mitigation needed:** plain start square (R-BOARD-004 variant, layout `classic-v2`) in `engineRulesVersion` 2. That version already has to ship for `letters-v2` at ≥ 2,000 forms (R-BAG-001), so no extra version bump. Confirm at batch 3 with Strategist using a pre-registered rule. | As D3 |

## 1. Method

**Simulator.** I used the B2 engine and bots (`packages/bots` simulator build, GADDAG path, `.clxi` built and
decoded) through a scratch harness (`harness.mjs`). The harness reuses `matchSeed`, `matchConfig` and the
`ranked`/`random-legal` policies and applies the same seat swapping. Personality fields can be overridden per
side. Rules variants run on the **built** engine (`packages/game-engine/dist`) patched by
`patch-engine-dist.py`. The patch adds opt-in overrides on `globalThis.__CLX_SIM__`: scoreless-limit units,
pass/exchange units, the term-bonus table, term bonus on the main word only, and a plain start square. With no
override set, the engine behaves exactly as `engineRulesVersion` 1. The source tree was never patched and dist was
rebuilt clean afterwards. I did not replay matches here (the B2 run already verified 22,000 replays), and floats
appear only in the harness's reporting.

**Reproduction check.** On the real lexicon, the 10,000-match Beginner mirror run under the same master seed
reproduces the B2 report exactly: 9,957 scoreless endings, first-player wins 5,196 / 9,926, bag empty in 53.22 %
of matches, term-bonus share 37.27 %. After a clean rebuild I applied the patch script again and reran two
variant runs: the output was byte-identical.

**Seeds.** Master seed `2026100300000b02`, seed stream `sim-match:<pairingIndex>:<i>`. Pairing index 0 =
mirrors, paired with the B2 report and with each other. 1 = Beginner vs random-legal and 2 = greedy vs Beginner,
both paired with the B2 pairings. 3 = sharp-vs-base Beginner. Every variant in a table shares the seed set of its
baseline. CIs are Wilson 95 %, with draws excluded from first-player and A-win rates.

**Lexicons** (`lex` field in `jobs.tsv`):

| Id | Forms | What it is |
|---|---|---|
| `real` | 1,501 | `packages/lexicon/data` at `4fa5884050b4ea53` (batch 2), profile `global-ranked` |
| `realsub:50` / `:75` | 747 / 1,133 | seeded 50 % / 75 % subsample of the real canonical terms (with their inflections): dose–response on real content |
| `realb3:2000` / `:2500` | 1,999 / 2,499 | **batch-3 proxy:** real + synthetic forms matching the batch-3 steering of E-1.7 C-LC-2 (3–4 letters 12 %, 5–7 45 %, 8–10 33 %, 11–12 10 %; difficulty 35/35/22/8 %; letters drawn from the `letters-v1` frequencies; no relations, no inflections) |
| `realplus:2000` / `:3000` | 1,999 / 2,999 | real + synthetic forms with the test-fixture length mix (36 % of 2–4 letters): an optimistic, short-form-rich batch 3 |
| `synth:2000` / `:5000` | 2,000 / 5,000 | fully synthetic (the `test/support/lexicons.ts` generator) |
| `enable:20000` / `:60000` | 20,000 / 60,000 | seeded sample of the public-domain ENABLE English word list (2–12 letters, sha256 `3f161302…3b1a89`, not committed): a dense natural-language control |

Caveat: synthetic forms are random strings, not words. They have no morphology, so plural hooks such as POD→PODS
are missing, and they have no relations. `realb3` is a direction-of-effect proxy, not a forecast of batch 3's exact
numbers.

Wall time: about 45 min on 4 shared vCPUs (≈ 50 matches/s/thread on the real lexicon).

## 2. D1 — Board lock-up is a lexicon effect; the guardrail measures the wrong thing

### 2.1 What "lock-up" actually is

The B2 headline says 99.6 % of matches end on scoreless turns with full racks. Split by the bag count at the end,
that becomes three different situations. On `real`, Beginner mirror, 10,000 matches:

| Bag at the end | Share | Meaning |
|---|---|---|
| 0 | 53.22 % | normal endgame block: nobody can go out, and R-SCORE-006 deducts the racks |
| 1–6 | 31.85 % | exchange not allowed (R-TURN-001, bag ≥ 7) and no word: forced passes |
| ≥ 7 | **14.93 %** | **premature lock:** three full-rack exchanges per seat found no word |

Mean tiles played: 84.8 of 100. The "racks full at p50" figure follows from the bag split: whenever the bag is not
empty (47 % of matches), both racks are full by construction. The mean is 11.9 tiles.

### 2.2 Rules axis: changing the limit changes nothing

Beginner mirror, 10,000 matches per row, seeds paired with the baseline:

| Variant (lexicon `real`) | Scoreless end | Going out | Bag ≥ 7 at end | Tiles played | Words / match | Actions / match |
|---|---|---|---|---|---|---|
| R-TURN-004 as is (3 × nSeats = 6) | 99.57 % | 43 | 14.93 % | 84.8 | 45.0 | 55.4 |
| limit 4 × nSeats (8) | 99.57 % | 43 | 14.11 % | 85.1 | 45.1 | 57.6 |
| limit 6 × nSeats (12) | 99.57 % | 43 | 13.32 % | 85.2 | 45.2 | 61.9 |
| limit 10 × nSeats (20) | 99.57 % | 43 | 12.49 % | 85.3 | 45.3 | 70.2 |
| exchange counts ½ (pass 2 units, exchange 1, limit 12 units) | 99.57 % | 43 | 13.32 % | 85.2 | 45.2 | 56.7 |
| **exchange never counts** (2,000 matches, safety cap 400 actions) | 88.90 % | 9 / 2,000 | 0 | 86.9 | 45.5 | — |
| ↳ matches that **never end** (hit the 400-action cap) | **10.65 %** | | | | | |

On the batch-3 proxy (`realb3:2000`), the 6 × nSeats limit gives 97.57 % → 97.57 %, tiles 89.8 → 90.0. On
`realplus:2000`, limits 4/6/10 and the half-weight exchange leave the scoreless rate at 86.1 % in every row, and
"exchange never counts" leaves 0.5 % of matches non-terminating.

Reading: allowing up to 20 consecutive scoreless turns adds **0.3 words and 0.5 tiles per match**, and not one
extra match goes out. On a locked board, more exchanges do not find words. The proposed "an exchange is not
scoreless while the bag can refill the rack" variant is worse than useless. An exchange needs a bag of ≥ 7, so the
bag can always refill the rack. Exchanges never shrink the bag, so on a locked board the match **never ends**
(10.65 % of matches on `real`). Counting exchanges is what guarantees that R-TURN-004 terminates.

**Decision D1-a:** R-TURN-004 is unchanged: 3 × active seats, and exchanges count. No rules PR. The termination
argument is worth a property in RULE_PROPERTIES (owner game-engine-engineer, task T-3).

### 2.3 Lexicon axis: a clear dose–response

Beginner mirror, rules v1, 10,000 matches per row (ENABLE rows 3,000). "No-word" = turns without a PlaceWord
taken while the bag held tiles (C-02 as restated in §7):

| Lexicon | Forms | Scoreless end | Bag ≥ 7 at end (C-10) | Bag 1–6 | Bag 0 | Tiles played (C-11) | No-word, bag not empty |
|---|---|---|---|---|---|---|---|
| real 50 % | 747 | 100.00 % | 67.79 % | 24.78 % | 7.43 % | 71.4 | 28.06 % |
| real 75 % | 1,133 | 99.92 % | 30.95 % | 40.43 % | 28.62 % | 80.9 | 20.07 % |
| **real (batch 2)** | 1,501 | 99.57 % | 14.93 % | 31.85 % | 53.22 % | 84.8 | 13.61 % |
| **batch-3 proxy** | 1,999 | 97.57 % | **3.63 %** | 13.04 % | 83.33 % | **89.8** | 6.30 % |
| batch-3 proxy | 2,499 | 91.89 % | 1.06 % | 4.60 % | 94.34 % | 92.9 | 2.82 % |
| real + short-rich | 1,999 | 86.11 % | 1.24 % | 3.46 % | 95.30 % | 93.9 | 1.90 % |
| real + short-rich | 2,999 | 53.05 % | 0.18 % | 0.56 % | 99.26 % | 96.8 | 0.36 % |
| synthetic | 2,000 | 62.40 % | 0.23 % | 0.67 % | 99.10 % | 96.4 | 0.45 % |
| synthetic | 5,000 | 24.52 % | 0.07 % | 0.17 % | 99.76 % | 97.8 | 0.12 % |
| ENABLE English | 20,000 | 97.80 % | 1.23 % | 10.50 % | 88.27 % | 90.5 | 6.22 % |
| ENABLE English | 60,000 | 66.63 % | 0.00 % | 0.13 % | 99.87 % | 96.1 | 0.41 % |

Greedy mirrors behave the same way: `real` 98.70 % scoreless, 6.20 % bag ≥ 7, 88.1 tiles; batch-3 proxy
93.74 % / 1.56 % / 92.2; `realplus:2000` 67.29 % / 0.43 % / 95.9; ENABLE 60,000 55.0 % / 0.05 % / 96.7.

Reading:

1. Premature lock falls steeply with lexicon size: from 67.8 % to 31.0 %, 14.9 % and 3.6 % as forms go from 747
   to 1,133, 1,501 and ≈ 2,000. Tiles played rise from 71 to 81, 85 and 90. Batch 3, as steered, should bring
   premature lock to ≈ 3–4 % and tiles played to ≈ 90.
2. **Short forms matter more than raw size.** At the same 2,000 forms, the short-rich augmentation (36 % of
   2–4-letter forms) beats the batch-3 steering mix (12 %) on every count: premature lock 1.2 % vs 3.6 %, tiles
   93.9 vs 89.8, scoreless endings 86 % vs 98 %.
3. **The ≤ 10 % scoreless-ending guardrail cannot be met by content.** Even a 60,000-word English lexicon ends 55
   % (greedy) to 67 % (Beginner) of matches on R-TURN-004. With no leave management and two blanks in 100 tiles,
   matches routinely end with the bag empty and a few unplayable tiles on both racks; R-SCORE-006 then deducts
   them. That is a normal ending, not a lock-up. The same tail also inflates the all-turns no-word rate. The
   batch-3 proxy shows 15.54 % no-word turns over all turns, but 6.30 % while the bag holds tiles. On lexicons of batch-2 to
   batch-3 size, every configuration ends with a mean tail of 5.0–5.7 forced turns (no word and no exchange
   possible); even at 60,000 English words the tail is 3.3–4.0.

**Decision D1-b (BALANCE.md, done):** C-02 is measured over turns taken while the bag is not empty, with the
all-turns rate still reported. New C-10 caps premature lock at ≤ 5 % and new C-11 sets tiles played ≥ 90, both
read on a Strategist mirror at batch 3. Batch 2 misses both (14.9 %, 84.8); the batch-3 proxy is at the limit
(3.6 %, 89.8).

**PO decision needed (D1-c):** the 11×11 Quick Classic trigger (BALANCE "Board-size fallback", decided by the PO
on 2026-10-02) fires on "> 10 % of games ending on scoreless turns". Read literally, it **will fire at batch 3
whatever the content** (proxy: 97.6 % Beginner, 93.7 % greedy) and would also fire on a 60,000-word English
lexicon. I recommend restating it as "> 10 % of games ending on R-TURN-004 with ≥ 7 tiles in the bag (C-10), or
C-11 < 90 tiles". The other two triggers (no-legal-word > 15 %, top-20 > 40 %) stay, with no-legal-word measured
as C-02. Until the PO decides, the trigger is read literally, which means 11×11 has to be simulated before the
playtest. The same restatement applies to the E-1.7 guardrail "Matches ending on scoreless turns ≤ 10 % at batch
3" (product-strategist).

**Content request (lexicon-curator, D1-d):** within AC-14, steer batch 3's new forms toward the **top of the
2–4-letter band**. Aim for ≈ 24 % of all forms at 2,000 forms, i.e. about +150 forms of 2–4 letters instead of the
≥ 55 minimum, while canonical, novice-skewed and 5–7-letter steering stays as is. Prefer forms that hook (plural
-S, verb forms on the C-LC-3 list) and vowel-bearing 3-letter forms. This is the single biggest lever on C-10 and
C-11.

**Deferred proposal P-1 (not decided):** the forced-pass tail costs the human about 3 taps at the end of nearly
every match. Candidate rule: "while no seat can exchange (bag < 7), the match ends after nSeats consecutive Passes".
It is outcome-neutral for bots, because a Pass changes no score, rack or board, but it removes a human's second and
third chance to spot a word. Decide after playtest Stage 1, using `bot_match_finished.end_reason` plus a bag-count
property (data-analyst) and the survey's pacing comments. If adopted, it ships in a later `engineRulesVersion`.

## 3. D2 — Beginner calibration

### 3.1 What drives the misses

Runs on pairing seeds 1 (vs random-legal) and 2 (greedy vs Beginner), 2,000 matches each. BG-2a is the new
vocabulary-matched yardstick: greedy with `maxDifficultyRank` 1. "easy" = novice or intermediate main words
(BG-4).

| Beginner variant | Lexicon | BG-1 vs random | BG-2 greedy wins | BG-2a matched greedy wins | BG-3 ppw ratio | BG-4 easy (BG-2 pairing; ‡ BG-1 pairing) |
|---|---|---|---|---|---|---|
| **v1** `mdr 1`, `[8,5,3,2,1]` | real | 63.36 % [61.21, 65.45] | 98.60 % | 78.92 % [77.08, 80.66] | 13.4 ÷ 21.0 = 64 % | 90.09 % |
| v1 | batch-3 proxy | 74.30 % [72.33, 76.17] | 98.35 % | 79.25 % [77.41, 80.97] | 14.1 ÷ 22.2 = 64 % | 93.54 % |
| **proposed** `mdr 1`, `[16,6,2,1]` | real | 75.34 % [73.40, 77.18] | 95.94 % | 67.30 % [65.21, 69.33] | 14.5 ÷ 20.9 = 69 % | 90.49 % |
| proposed | batch-3 proxy | **84.67 %** [83.02, 86.18] | 96.14 % | **68.98 %** [66.91, 70.97] | 15.3 ÷ 22.0 = **70 %** | **93.75 %** |
| proposed + plain start | batch-3 proxy | 84.58 % | — | — | — | 92.04 % ‡ |
| proposed + plain start + term bonus 0/3/6/12 | batch-3 proxy | 88.52 % | 95.19 % | — | 13.8 ÷ 19.4 = 71 % | 93.83 % |
| `mdr 2`, `[8,5,3,2,1]` | real / proxy | 91.68 % / 95.65 % | 86.93 % / 88.29 % | — | — | **54.39 % / 52.96 %** |
| `mdr 2`, `[16,6,2,1]` | real / proxy | 95.14 % / 97.70 % | 77.02 % / 78.99 % | — | — | **51.68 % / 50.83 %** |
| `mdr 3`, `[16,6,2,1]` | real / proxy | 97.25 % / 99.05 % | 67.55 % / 66.85 % | — | — | 45.54 % / 43.90 % |

Proposed vs v1, head to head (`real`, 2,000 matches, seed pairing 3): the proposed Beginner wins **64.47 %**
[62.34, 66.55].

Reading:

- **BG-2's 98.8 % is the vocabulary filter, by design.** Give greedy the same vocabulary and it beats Beginner
  only 79 % of the time, inside the 65–85 % band. The rest of the gap is knowledge: Beginner forgoes the
  advanced/expert term bonus (pillar 3: knowledge is rewarded). Halving the term bonus barely moves it (95.9 % at
  0/2/4/8). BG-2 as written mixes playing skill with vocabulary.
- **BG-1 depends on the lexicon.** v1 goes from 63 % to 74 % on the batch-3 proxy, and to 85 % on
  `realplus:2000`. With tiny candidate sets, ranking adds little; random-legal also plays the full vocabulary,
  advanced/expert terms included (37 % of its words).
- **BG-4's miss is lexicon thinness.** The filter falls back when no easy word exists (§5.3 step 1): 88–90 % on
  batch 2, 93.5 % on the proxy.
- Raising `maxDifficultyRank` fixes BG-1/BG-2 numerically but breaks the persona. Half of Beginner's words become
  advanced/expert (BG-4 ≈ 51–54 %), against F-8 ("knows mostly everyday tech words") and against the stated
  playtest risk R-7 ("Beginner too strong for non-engineers"). Rejected.
- A sharper pick ("plays the best visible move more often") keeps the persona and BG-4. It clears BG-1 on the
  batch-3 proxy (84.7 %) and keeps BG-2a inside the band (69 %).

### 3.2 Decision

- **Proposal to ai-engineer (`BOT_VERSION` 1 → 2):** Beginner `topWeights` `[8, 5, 3, 2, 1]` → `[16, 6, 2, 1]`.
  All other fields unchanged (`maxDifficultyRank` 1, `shortLength` 5 × 2, `skipFullStackPermille` 500,
  `maxCandidates` 300). Before the length multiplier the best move is picked 16/25 = 64 % of the time instead of
  42 %. BG-5 is unaffected: generation and the budget are unchanged.
- **Targets (to be restated in bots-api §5.4 by ai-engineer):**

| ID | Restated target | Read at |
|---|---|---|
| BG-1 | ≥ 80 % (unchanged) | final at batch 3 / E-1.6; batch 2 informative only |
| BG-2a *(new)* | vocabulary-matched greedy (greedy with `maxDifficultyRank` 1, simulator-only yardstick) vs Beginner: **65–85 %** | batch 3 |
| BG-2b *(was BG-2)* | full-vocabulary greedy vs Beginner: **reported, no target**. The gap is the intended knowledge reward; human fit is judged by F-9 (human win ≥ 55 %) and `score_margin` | every readout |
| BG-3 | 55–75 % (unchanged) | batch 3 |
| BG-4 | ≥ 90 % (unchanged) | batch 3 |
| BG-5 | ≤ 1 % (unchanged) | every readout |

- **O-2 (bots-api §9):** confirmed. A forced exchange when no word exists is not a strategic exchange, so BOT-6's
  reading of F-8 stands. Note from §2.2: the full-rack forced exchange is also what keeps a stuck bot's match
  terminating.
- B-07 is safe: v1 → proposed is +14.5 points head to head. Strategist must still beat the proposed Beginner in
  ≥ 60 % of matches, and greedy beats it 96 % of the time.

## 4. D3 — C-05 term-bonus weight

Term-bonus share of all points (C-05 ≤ 35 %, defined on a Strategist mirror; greedy is the closest available
proxy for a strong player) and the side effect on B-01 (first-player win, draws excluded). Greedy mirrors at
10,000 matches unless marked †, which are 2,000.

| Term bonus (nov/int/adv/exp) | Lexicon | Share, Beginner mirror | Share, greedy mirror | Greedy ppw (C-03) | B-01, Beginner mirror (DW start) | B-01, greedy mirror (DW start) |
|---|---|---|---|---|---|---|
| 0/4/8/16 (v1) | real | 37.27 % | 49.02 % | 20.8 | 52.35 % [51.36, 53.33] | 52.51 % [51.53, 53.49] |
| 0/3/6/12 | real | 30.39 % | 40.43 % † | 18.2 | 52.72 % [51.74, 53.70] | 51.43 % † |
| 0/2/4/8 | real | 21.97 % | 28.94 % † | 15.9 | 53.35 % [52.37, 54.33] | 51.21 % † |
| main word only, 0/4/8/16 | real | 28.79 % | 43.29 % † | 18.5 | **55.67 %** [54.69, 56.65] | 53.31 % † |
| 0/4/8/16 (v1) | batch-3 proxy | 35.25 % | 47.83 % | 22.0 | 53.38 % [52.40, 54.36] | 52.23 % [51.24, 53.21] |
| 0/3/6/12 | batch-3 proxy | 28.32 % | 38.98 % † | 19.4 | 52.76 % [51.78, 53.74] | 52.93 % † |
| 0/2/4/8 | batch-3 proxy | 20.12 % | 27.51 % † | 17.1 | 53.92 % [52.94, 54.90] | 50.75 % † |
| **with plain start:** 0/3/6/12 | batch-3 proxy | 28.65 % | 39.34 % | 19.3 | 49.29 % [48.31, 50.27] | 50.30 % [49.31, 51.28] |
| **with plain start: 0/2/4/8** | batch-3 proxy | 20.39 % | **27.91 %** | **16.9** | **49.94 %** [48.96, 50.92] | **49.40 %** [48.42, 50.38] |

Reading:

- The C-05 miss is real and large for strong play: 48–49 % in the greedy mirror, where the B2 readout's
  37–44 % came from Beginner-involved pairings. Beginner mirrors sit near 35 % only because Beginner avoids the
  big bonuses.
- Scaling the bonus to 75 % still misses for strong play (39 %). Halving it meets C-05 with margin (27.5–28.9 %)
  and keeps greedy's points per word inside C-03 (16.9–17.1 vs 15–30).
- **Cutting the term bonus while the start DW remains raises the first-player advantage.** Letter and premium
  points then weigh more, including the opener's guaranteed DW. Main word only: 52.35 % → 55.67 %, a significant
  shift on paired seeds. 0/2/4/8: +1.0 point on `real` (not significant alone) and +0.5 on the proxy. With the
  plain start, every term-bonus option sits at 49.3–50.4 %.
- Knowledge is still rewarded at 0/2/4/8: expert +8 is about half of a strong player's mean points per word, and
  Beginner still loses to full-vocabulary greedy by 95.9 %.

**Decision D3:** the term-bonus weight **should change, in `engineRulesVersion` 2, together with the plain
start**, and never alone in `engineRulesVersion` 1.

- Candidate: **0/2/4/8**. Final constants are chosen in the `engineRulesVersion` 2 `/balance-check`
  (Strategist mirror, batch 3, `letters-v2` as derived, 10,000 paired matches per variant).
- Pre-registered rule: take 0/3/6/12 if Strategist measures it at C-05 ≤ 35 % with B-01 held; otherwise
  0/2/4/8.
- "Term bonus on the main word only" is rejected: least effective, and the worst for B-01.

Coupling: R-SCORE-003 says the constants are "the same as the lexicon game value" (LEXICON_SPEC §4).
lexicon-engineer and lexicon-curator decide whether `gameValue` follows the change or decouples from it; Knowledge
Cards that show "+16" need ux-ui-designer copy. No economy impact (monetization-liveops not involved).

## 5. D4 — B-01 first-player advantage

| Start square | Lexicon | Beginner mirror (10,000) | Greedy mirror (10,000) | C-08 lead (Beginner / greedy) |
|---|---|---|---|---|
| DW (v1) | real | 52.35 % [51.36, 53.33] | 52.51 % [51.53, 53.49] | 4.9 / 4.8 |
| plain | real | 49.05 % [48.07, 50.03] | 50.09 % [49.11, 51.07] | −0.3 / −0.7 |
| DW (v1) | batch-3 proxy | **53.38 % [52.40, 54.36]** | 52.23 % [51.24, 53.21] | 6.1 / 4.7 |
| plain | batch-3 proxy | 50.36 % [49.37, 51.34] | 49.48 % [48.50, 50.46] | 0.4 / −1.2 |

Reading:

- With the batch-2 lexicon B-01 is borderline for both bots (point estimates 52.35 % and 52.51 %, both CIs
  containing 52 %).
- On the batch-3 proxy the Beginner mirror **breaks B-01** (CI lower bound 52.40 %). As shown in §4, any C-05 fix
  pushes the same way.
- The plain start removes the excess everywhere (49.05–50.36 %) without side effects: scoreless and lock-up rates,
  tiles played and words per match are unchanged (e.g. `real` Beginner: 99.59 % / 14.84 % / 84.8 / 45.0), and the
  mean total score drops by about 5 points.

**Decision D4:** first-player mitigation is **needed** and is the plain start (layout `classic-v2`, §6), shipped in
`engineRulesVersion` 2. `engineRulesVersion` 1 is unchanged. Timing costs nothing extra: `letters-v2` must ship as
a new `engineRulesVersion` at ≥ 2,000 forms anyway (R-BAG-001), and no action log is persisted yet (game-engine API
§20 Q1/Q2 still two-way).

Confirmation, pre-registered: at batch 3, run a Strategist mirror (greedy if Strategist is late), 10,000 paired
matches, DW vs plain start, both with the chosen term bonus and `letters-v2`. Ship the plain start **unless** it
over-corrects, i.e. the first-player win with the plain start is < 48 % (second-player advantage beyond B-01's
mirror image). The protocol does not ask for re-measuring before preparing the change, so the engine work can
start now.

## 6. Proposed GAME_RULES diff (for a separate, reviewed rules PR; NOT applied)

Version 0.4, all under a new **`engineRulesVersion` 2**. Rules text for `engineRulesVersion` 1 stays normative for
v1 matches.

```diff
@@ R-CORE-004
-  The result is part of the initial state and is announced before the first move. There is no first-move
-  compensation in v0.2: first-player advantage is measured by B-01 and any mitigation (e.g. the R-BOARD-004
-  variant) is decided on simulation evidence.
+  The result is part of the initial state and is announced before the first move. *(v0.4)* First-move
+  compensation: `engineRulesVersion` 1 has none; from `engineRulesVersion` 2 the start square carries no premium
+  (R-BOARD-004, decision note 2026-10-b2-response D4). No other compensation (score, tile or tie-break) exists
+  outside R-END-003 step (2).
@@ R-BOARD-004
-- **R-BOARD-004** *(new v0.2)* **Start square premium.** The start square of the Classic layout is a DW ⚙. The
-  first PlaceWord of the match must cover it and must place ≥ 2 tiles. Simulation variant to evaluate against B-01:
-  start square without premium (reduces the first mover's guaranteed DW).
+- **R-BOARD-004** *(amended v0.4)* **Start square.** The first PlaceWord of the match must cover the start square
+  and must place ≥ 2 tiles. In `classic-v1` (`engineRulesVersion` 1) the start square is a DW. In `classic-v2`
+  (`engineRulesVersion` 2) it carries **no premium** (B-01: first-player win 52.2–53.4 % with the DW start vs
+  49.1–50.4 % without, 10,000-match mirrors; decision note 2026-10-b2-response D4). It stays marked as the start.
@@ §2.1 (new subsection after the classic-v1 rationale)
+### 2.2 Classic layout `classic-v2` (normative for `engineRulesVersion` 2)
+Identical to `classic-v1` (§2.1) except the start square `(7,7)`, which is plain (shown `ST`, no premium).
+DW count 12, premium squares 60 of 225 (26.7 %). D4 symmetry unchanged. The first move can reach no word
+multiplier at all; with ≥ 6 tiles it can reach one DL at (7,2)/(7,12)/(2,7)/(12,7).
@@ §2.1 tech squares paragraph
-placed later as category tags on existing or plain squares in a new layout id (e.g. `classic-v2`), which bumps
+placed later as category tags on existing or plain squares in a new layout id (e.g. `classic-v3`), which bumps
@@ R-SCORE-003
-- **R-SCORE-003** **Term bonus**: each scored word adds a difficulty bonus: novice 0, intermediate +4,
-  advanced +8, expert +16 ⚙ (same constants as the lexicon game value, `LEXICON_SPEC.md` §4).
+- **R-SCORE-003** **Term bonus**: each scored word adds a difficulty bonus, frozen per `engineRulesVersion`:
+  `engineRulesVersion` 1: novice 0, intermediate +4, advanced +8, expert +16; `engineRulesVersion` 2: novice 0,
+  intermediate +2, advanced +4, expert +8 ⚙ (final values from the v2 `/balance-check`, decision note
+  2026-10-b2-response D3; relation to the lexicon game value per `LEXICON_SPEC.md` §4).
@@ R-TURN-004 (clarification only, no behaviour change)
+  *(v0.4 rationale)* Exchanges count because an exchange never shrinks the bag: on a board where no rack can
+  place a word, a counter that ignored exchanges would never end the match (simulated: 10.7 % of matches on the
+  batch-2 lexicon). Raising the limit to 4–10 × nSeats changed no simulated outcome.
@@ §9 Changelog
+- 0.4 — <date of the rules PR> · `game-designer` · `engineRulesVersion` 2: R-BOARD-004 plain start (`classic-v2`),
+  R-SCORE-003 v2 constants, R-CORE-004 compensation note, `letters-v2` (§3.1, separate derivation record);
+  R-TURN-004 rationale (no change). Evidence: docs/game/decisions/2026-10-b2-response.md.
```

## 7. BALANCE.md changes made in this branch (0.4)

The evidence supports these:

- **C-02** is measured over turns taken while the bag is not empty, with the all-turns rate still reported. The
  forced-pass tail (≈ 5–6 turns per match, at every lexicon size) otherwise dominates the metric. The target
  (≤ 15 %) is unchanged.
- **C-10** (new): premature lock (R-TURN-004 ending with bag ≥ 7) ≤ 5 %.
- **C-11** (new): mean tiles played ≥ 90.
- A **measurement note** under the 11×11 fallback. The rule text is unchanged because it belongs to the PO (D1-c).

B-01..B-07, C-05 and every other target are unchanged.

## 8. Owner tasks

| Task | Owner | Content | Blocks |
|---|---|---|---|
| T-1 | ai-engineer | `BOT_VERSION` 2: Beginner `topWeights` [16,6,2,1]; re-pin goldens; restate BG table in bots-api §5.4 (BG-2a/2b); add the simulator-only yardstick "greedy, `maxDifficultyRank` 1"; add simulator metrics: bag-at-end split (0 / 1–6 / ≥ 7), tiles played, forced-pass tail, no-word turns with a non-empty bag | batch-3 readout |
| T-2 | ai-engineer + game-engine-engineer | Simulator support for `engineRulesVersion` 2 candidates (layout `classic-v2`, term-bonus table per version, `letters-v2`) so the v2 `/balance-check` runs on the real engine, not on a dist patch | v2 balance-check |
| T-3 | game-engine-engineer | `engineRulesVersion` 2 constants per ADR-0013 (layout `classic-v2`, R-SCORE-003 table, `letters-v2` slot); golden cases for R-BOARD-004 v2; a RULE_PROPERTIES property "R-TURN-004 terminates" (exchanges count; no bag growth) | rules PR 0.4 |
| T-4 | game-designer | Rules PR 0.4 (diff in §6) after T-3 and the v2 `/balance-check`; `letters-v2` derivation record at ≥ 2,000 forms | batch 3 |
| T-5 | lexicon-curator | Batch-3 steering: 2–4-letter forms toward ≈ 24 % of forms (about +150), hook-friendly, vowel-bearing 3-letter forms (D1-d) | batch 3 |
| T-6 | lexicon-engineer | `gameValue` vs term-bonus coupling if R-SCORE-003 changes (LEXICON_SPEC §4); still open: the `inflections: none` profile option | rules PR 0.4 |
| T-7 | product-strategist + **PO** | Restate the 11×11 trigger and the E-1.7 scoreless-ending guardrail as C-10/C-11 (D1-c); E-1.7 primary KPI measured as C-02 | before the batch-3 readout |
| T-8 | ux-ui-designer | `classic-v2` start square without "DW" (still the ★ start); Knowledge Card copy for v2 bonus values | rules PR 0.4 |
| T-9 | data-analyst | Playtest: bag count at match end in `bot_match_finished`, `score_margin` (F-9), forced-pass tail (P-1) | playtest Stage 1 |

`monetization-liveops`: not involved (no economy, store or progression change).

## 9. Needs the product owner

1. **D1-c:** restate the 11×11 trigger (and the E-1.7 scoreless guardrail) as premature lock / tiles played.
   Otherwise the literal trigger fires at batch 3 regardless of content, and 11×11 must be simulated before the
   playtest.
2. **Awareness:** `engineRulesVersion` 2 will carry three outcome changes at once: `letters-v2` (already
   planned), the plain start (D4) and lower term bonuses (D3). The playtest build should ship v2 if the v2
   `/balance-check` is done by batch 3; otherwise v1, accepting a known B-01 risk in casual vs-bot play only.

### 9.1 Orchestrator decisions (2026-10-04, on the product owner's standing delegation; reversible)

1. **D1-c accepted.** The 11×11 Quick Classic trigger and the E-1.7 scoreless guardrail are restated as C-10
   (games locked with ≥ 7 tiles in the bag ≤ 5 %) and C-11 (tiles played ≥ 90). The rule text change goes into the
   same reviewed rules PR as §6, with the E-1.7 spec update (owner: game-designer, product-strategist).
2. **Fallback accepted.** The playtest ships `engineRulesVersion` 2 only if its `/balance-check` passes by
   lexicon batch 3; otherwise it ships v1 and accepts the B-01 risk in casual vs-bot play only (no ranked,
   no leaderboard in Phase 1). Recorded in the sprint 3 plan as a gate.

## 10. Risks and limits

- **Proxy risk.** The batch-3 numbers come from synthetic forms without morphology or relations. Real batch-3
  content (more plural hooks, chain links) should do *better* on lock-up; its effect on B-01 is unknown, which is
  why D4 has a pre-registered confirmation step.
- **Bots are not humans.** Neither Beginner nor greedy manages its leave, and both exchange the whole rack. Humans
  may lock less often (partial exchanges) or more (they miss words). C-10 and C-11 should also be read in the
  playtest.
- **Greedy stands in for Strategist.** Strategist (next sprint) values leave and blocks lanes. Every C-05 and B-01
  number here must be re-read on a Strategist mirror before the rules PR.
- **Sample sizes.** Mirrors are 10,000 matches; Beginner grids and some term-bonus cells are 2,000 (marked †, CI
  ≈ ±2.2 points). Every decision rests on 10,000-match rows, and the 2,000-match rows only show direction.
