# E-1.6 — Pre-registered pass list for the `engineRulesVersion` 2 `/balance-check`

- Epic: E-1.6 (Classic calibration) · Sprint: `docs/sprints/2026-10-04-phase1-playtest-gates.md`, task **V1**
  (feeds task **BC**, then **R4**) · Owner: `game-designer` · Status: **Pre-registered** (2026-10-04)
- Inputs: `docs/game/decisions/2026-10-b2-response.md` (D1–D4, §6 proposed rules diff, §9.1),
  `docs/game/BALANCE.md` 0.4 (B-01, B-07, C-02, C-05, C-10, C-11), `.claude/skills/balance-check/SKILL.md`,
  `docs/architecture/notes/bots-api.md` §5.4 (BG targets, restated in the decision note §3.2).
- Reviewers: `ai-engineer` (simulator and readout script, B3), `game-engine-engineer` (draft constants, E6),
  `product-strategist` (sprint indicators 3 and 4). `monetization-liveops`: not involved (no economy change).

**Pre-registration rule.** This file is merged to `main` **before any v2 run** (§1.3). Sections 1–6 are frozen
from that merge. After a run, the only allowed edit is to append to §8 (Outcome). Any other change to §1–§6 is a
new pre-registration (§5.4).

## 1. Scope

### 1.1 Question

Which rules version does the playtest build pin?

- `engineRulesVersion` 2, and with which term-bonus constants (D3);
- or `engineRulesVersion` 1, recording the B-01 risk (§9.1 fallback).

### 1.2 Hypotheses (stated before the run, with the prior evidence)

The priors come from the batch-3 proxy (`realb3:2000`) in the decision note §4–§5: greedy and Beginner v2 mirrors,
DW-start rows patched into dist. They are **not** pass evidence: the proxy has no morphology, and greedy is not
Strategist.

| # | Hypothesis | Prior (proxy) | Criterion that tests it |
|---|---|---|---|
| H1 | On batch 3, v1 (DW start) gives the first player more than 52 % | Beginner 53.38 % [52.40, 54.36]; greedy 52.23 % [51.24, 53.21] | B-01 on `v1` (reported, §3.4) |
| H2 | The plain start (`classic-v2`) brings B-01 inside [48 %, 52 %] without over-correcting | greedy 50.30 % / 49.40 %; Beginner 49.29 % / 49.94 % (0/3/6/12 / 0/2/4/8) | P-1, S-1 |
| H3 | 0/3/6/12 misses C-05 ≤ 35 % for strong play; 0/2/4/8 meets it | greedy 39.34 % vs 27.91 % | P-2 |
| H4 | `letters-v2` + plain start do not worsen lock-up or coverage vs v1 on the same lexicon | proxy: no change from the plain start | P-3..P-6 vs `v1` |
| H5 | v2 constants do not break the bot ladder or Beginner calibration | proposed Beginner + plain start + 0/3/6/12: BG-1 88.5 %, BG-3 71 %, BG-4 93.8 % | B-07, BG-* |

**Expected outcome, written down now:** H3 predicts that the D3 rule picks **0/2/4/8**. If 0/3/6/12 passes, that
is a surprise to explain in the digest; it does not change the rule.

### 1.3 What counts as a "v2 run"

A v2 run is any simulation that:

- uses `engineRulesVersion` 2 draft constants (or any of §2's v2 variants);
- runs on the batch-3 lexicon;
- and produces any metric in §3.

Exempt: unit and property tests and smoke suites that run v2 drafts with ≤ 100 matches per pairing, or on test
lexicons, to prove correctness (B3/E6 test suites). They are never evaluated against §3 and are not reported as
balance evidence.

## 2. Variants

All variants use the same lexicon, bots and seeds (§4). Only the rules constants differ.

| Variant id | Role | Layout (R-BOARD-004) | Letters (R-BAG-001) | Term bonus nov/int/adv/exp (R-SCORE-003) |
|---|---|---|---|---|
| `v1` | **Baseline**: the fallback version; needed for §3.4 and §5.3 | `classic-v1` (DW start) | `letters-v1` (frozen) | 0/4/8/16 |
| `v2-3612` | **Candidate A** (gating) | `classic-v2` (plain start) | `letters-v2` (task L7) | 0/3/6/12 |
| `v2-248` | **Candidate B** (gating) | `classic-v2` (plain start) | `letters-v2` (task L7) | 0/2/4/8 |
| `dx-dw-3612` | Diagnostic (D4 attribution), never gating | `classic-v1` (DW start) | `letters-v2` | 0/3/6/12 |
| `dx-dw-248` | Diagnostic (D4 attribution), never gating | `classic-v1` (DW start) | `letters-v2` | 0/2/4/8 |

Notes:

- `letters-v2` is the table derived by task L7 (BALANCE.md R-BAG-001 steps 1–6) from the **same** batch-3 lexicon
  commit as §4.3. Its derivation record must be merged before the run.
- `letters-v1` stays frozen for `v1`. Re-derivation applies only to a new version.
- Diagnostics run on the primary mirror only (§3.1, pairing 0). They need a simulator override that mixes a v1
  layout with v2 letters (T-2). If B3 cannot express that mix, they are skipped and the digest says so; the gating
  verdict never depends on them.
- No other variant is evaluated (for example a half-way term bonus, or main-word-only scoring, which D3 rejected).
  Adding one requires a new pre-registration (§5.4).

## 3. Protocol and pass criteria

### 3.1 Pairings

Pairing indices are fixed, and every variant lists them **in this order**. The simulator derives seeds from the
pairing index (`sim-match:<pairingIndex>:<matchIndex>`), so a different order would silently unpair the variants.

| Index | Pairing | Matches per variant | Used for |
|---|---|---|---|
| 0 | **Strategist v2 mirror** (primary) | 10,000 | P-1..P-6 |
| 1 | **Beginner v2 mirror** (secondary) | 10,000 | S-1, reported metrics |
| 2 | Strategist v2 vs Beginner v2 | 2,000 | B-07 |
| 3 | Beginner v2 vs random-legal | 2,000 | BG-1 |
| 4 | Vocabulary-matched greedy (`maxDifficultyRank` 1) vs Beginner v2 | 2,000 | BG-2a |
| 5 | Full-vocabulary greedy vs Beginner v2 | 2,000 | BG-2b (reported), BG-3, BG-4 |

Common settings:

- Seats are swapped on every other match (`seatsFor`).
- 1v1 Classic 15×15, `untimed-vs-bot`.
- `BOT_VERSION` 2: Beginner `topWeights` [16, 6, 2, 1]; Strategist as merged by B4 with its provisional budget.
- Every match is replayed to identical state hashes.

The 2,000-match pairings follow the B2 convention for bot-calibration grids (Wilson half-width ≤ 2.2 points).
The 10,000-match mirrors carry the version decision.

### 3.2 Statistics conventions

- **Proportions:** Wilson 95 % score interval as computed by `wilsonBp` (`packages/bots/sim/stats.ts`), in basis
  points, with the lower bound rounded down and the upper bound rounded up (conservative).
- **Win rates (B-01, B-07, BG-1, BG-2a):** draws are excluded from the denominator. The draw count is reported.
- **Ratios of sums (C-05, BG-3):**
  - C-05 = Σ term-bonus points ÷ Σ PlaceWord points (`termBonusShareBp`; R-SCORE-006 end deductions are
    excluded).
  - CI by the delta method, with the match as the unit: `SE = sqrt(Σ(Bᵢ − R·Tᵢ)² / (n(n−1))) / T̄`, and upper
    bound `R + 1.96·SE`.
- **Means (C-11):** mean of per-match values, with a normal 95 % CI from the sample standard deviation.
- **Thresholds are inclusive.** A value exactly on a threshold passes. Comparisons are made on integers (basis
  points or tenths) as emitted by the simulator, never on re-rounded percentages.
- **No multiplicity correction.** The criteria are pass/fail gates, not tests of effects. Strictness comes from
  the CI rule chosen per criterion below.

### 3.3 Criterion classes

| Class | Meaning | Effect of a FAIL on a v2 candidate |
|---|---|---|
| **R** (rules) | Moved by the rules constants under test | Always eliminates the candidate |
| **L** (lexicon) | Driven by batch-3 content (decision note D1) | Eliminates the candidate **unless** `v1` also fails the same criterion under the same rule. Then it is recorded as a lexicon failure: falling back would not fix it. It is routed to `lexicon-curator` and to the restated 11×11 trigger (§9.1-1), and it does not decide the version |
| **K** (bot ladder and calibration) | Driven by bot parameters (B4, T-1) | Same as L, routed to `ai-engineer` |
| **I** (integrity) | Validity of the run itself | A failure makes the run **invalid** (§5.4 b), not a candidate FAIL |

Any criterion that is not measured counts as a **FAIL** for that candidate. The only exception is §5.2's
Strategist-late path.

### 3.4 Pass list

A v2 candidate **passes** if every R criterion passes, every L and K criterion passes (or is excused under §3.3),
and every I check holds.

| ID | Pairing | Class | Metric | Pass rule (95 % CI) | Prior, proxy (0/3/6/12 · 0/2/4/8) |
|---|---|---|---|---|---|
| **P-1** (B-01) | 0 | R | First-player win rate, draws excluded | **Whole CI inside [48.00 %, 52.00 %]**: `lo ≥ 4800 bp` and `hi ≤ 5200 bp`. The 48 % floor is the over-correction limit from D4. At n ≈ 10,000 the half-width is ≈ 0.98 points, so the point estimate must sit within about [48.98 %, 51.02 %] | greedy 50.30 [49.31, 51.28] · 49.40 [48.42, 50.38] |
| **P-2** (C-05) | 0 | R | Term-bonus share of PlaceWord points | **Upper CI ≤ 35.00 %**. This is the criterion that decides D3, so it must be met with confidence, not on the point estimate | greedy 39.34 % · 27.91 % |
| **P-3** (C-02) | 0 | L | No-PlaceWord turns among turns taken with a non-empty bag (all-turns rate reported) | point ≤ 15.00 % | greedy n/a; Beginner 6.30 % (v1 rules) |
| **P-4** (C-10) | 0 | L | Matches ending on R-TURN-004 with bag ≥ 7 | point ≤ 5.00 % | greedy 1.56 % (v1 rules) |
| **P-5** (C-11) | 0 | L | Mean tiles played per match | point ≥ 90.0 | greedy 92.2 (v1 rules) |
| **P-6** (top-20) | 0 | L | Top-20 terms' share of main words played (E-1.7 guardrail, sprint indicator 3) | point ≤ 40.00 % | not measured on proxy |
| **S-1** (B-01, secondary) | 1 | R | First-player win rate, Beginner v2 mirror | **No significant violation:** FAIL if `lo > 5200 bp` or `hi < 4800 bp`. Beginner is not the reference bot for B-01, but the playtest opponent must not show a clear seat advantage | 49.29 [48.31, 50.27] · 49.94 [48.96, 50.92] |
| **B-07** | 2 | K | Strategist v2 win rate vs Beginner v2, draws excluded | **Lower CI ≥ 60.00 %** | not measured (greedy vs Beginner v2: 95–96 %) |
| **BG-1** | 3 | K | Beginner v2 win rate vs random-legal | point ≥ 80.00 % | 88.52 % (with 0/3/6/12) |
| **BG-2a** | 4 | K | Matched greedy win rate vs Beginner v2 | point in [65.00 %, 85.00 %] | 68.98 % (v1 rules) |
| **BG-3** | 5 | K | Beginner ppw ÷ full greedy ppw | point in [55.0 %, 75.0 %] | 71 % (with 0/3/6/12) |
| **BG-4** | 5 | K | Beginner main words that are novice or intermediate | point ≥ 90.00 % | 93.83 % (with 0/3/6/12) |
| **BG-5** | 1, 3, 4, 5 | K | Beginner `budgetExhausted` decisions | point ≤ 1.00 % of Beginner decisions | 0 % (B2) |
| **I-1** | all | I | Replay verification | 100 % of matches replay to identical hashes | — |
| **I-2** | all | I | Engine acceptance | 100 % of bot actions accepted by `apply` (no fallback forced by a rejection) | — |
| **I-3** | all | I | Provenance | Results JSON carries the commits, seed, versions and hashes listed in §6, and they match §4 | — |

**Reported, never gating.** These are listed so that nobody promotes one to a gate after seeing the results:

- BG-2b;
- C-03 (points per word, 15–30), C-04, C-06, C-07, C-08 (first-mover lead), C-09 (hook tripwire);
- draw rate, mean and σ of total score, words and actions per match;
- the bag-at-end split (0 / 1–6 / ≥ 7) and the forced-pass tail;
- inflection share;
- Strategist `budgetExhausted` and node p95;
- the same metrics on pairing 1;
- **paired differences on shared seeds**: `v2-3612` − `v2-248`, each v2 candidate − `v1`, and each candidate − its
  `dx-dw-*` twin (the D4 plain-start effect).

Pairing is exact between the two candidates (same layout and bag). Against `v1` and the `dx-dw-*` twins, the bag
contents differ under the same seed, so those differences are only partially paired.

**Recorded for the fallback.** The `v1` variant is evaluated against the same pass list. Its P-1 and S-1 values
with CIs are the B-01 risk carried into the playtest if v1 ships (§5.3).

## 4. Fixed inputs

### 4.1 Master seed

**`2026100400000e16`** (16 hex digits).

- Fixed on 2026-10-04 by this pre-registration.
- New on purpose: distinct from `2026100300000b02` (B2 and the decision note). The v2 candidates were chosen while
  looking at that seed set, so the confirmatory run must use fresh seeds.
- Match seed = `matchSeed("2026100400000e16", pairingIndex, matchIndex)` (`packages/bots/sim/simulate.ts`).

### 4.2 Sample sizes

- Pairings 0 and 1: 10,000 matches per variant.
- Pairings 2–5: 2,000 matches per variant.
- Match indices start at 0 and are contiguous.
- No early stopping. No partial results are evaluated against §3.

### 4.3 Lexicon

The **merged batch 3**:

- the first `main` commit on which the last C3 PR is merged and the validator reports AC-14 met (0 errors,
  0 open NEEDS_REVIEW);
- profile `global-ranked` with inflections (the profile the playtest ships).

The run records that commit SHA, `lexiconVersion`, `profileId` and `definitionHash`. `letters-v2` (L7) must be
derived from the same commit. If a later lexicon commit lands before the run, the run still uses the commit
defined here, and the digest notes the gap. A content fix found after the run is a new `lexiconVersion` and needs a
new pre-registration to re-decide.

### 4.4 Code

The run uses the `main` commit containing B3, B4, E6 and L7, plus this file. That commit is the workflow input
(§6) and is recorded together with `engineRulesVersion` (1 and the v2 draft), `BOT_VERSION` 2 and the
Strategist budget.

## 5. Decisions

### 5.1 D3 decision rule (term-bonus constants)

Apply the rules in order. The first one that matches decides.

1. `v2-3612` passes (§3.4) → **v2 ships with 0/3/6/12**.
2. Otherwise, `v2-248` passes → **v2 ships with 0/2/4/8**.
3. Otherwise → **v2 fails**: the v1 fallback applies (§5.3).

Tie-breaks and edge cases, decided now:

- **Both pass** → 0/3/6/12. The preference is pre-registered: a larger knowledge reward (pillar 3). No secondary
  comparison is made: not closeness of B-01 to 50 %, not C-05 margin, not BG fit.
- **Exactly on a threshold** → pass (§3.2).
- **A candidate passes only through an L or K excuse** (§3.3) → it still counts as passing. The excused failure is
  recorded and routed to its owner. For the version decision, two candidates that pass, with or without excuses,
  are treated as equal; the order 1 → 2 still applies.
- **One candidate is excused on an L/K criterion that the other passes outright** → no effect; the order 1 → 2
  still applies.
- **A candidate fails only S-1** → it fails (S-1 is class R).
- **Diagnostics** (`dx-dw-*`) never change the outcome, even if they look "better".
- **A v2 candidate fails P-1 by over-correcting** (`lo < 4800`) → it fails. The plain start is not swapped back for
  the DW start inside this run: that is a new variant and needs a new pre-registration.

### 5.2 Strategist-late path

If B4 has not met its acceptance criteria by **D0+7 (2026-10-11)**, the run may start without Strategist:

- Pairing 0 becomes the full-vocabulary greedy mirror, on the same seeds and indices.
- Pairing 2 is skipped. B-07 is recorded "not measured" and is excused for this decision only.
- The decision is labelled **provisional (greedy proxy)**.
- It becomes final only if a Strategist mirror run under this same file (same seed, variants and rules, with
  pairing 0 restored) confirms it **before R4 freezes `replays/v2`**. If that confirmation fails, or is not run,
  R4 does not freeze v2 and the build pins v1 (§5.3).

### 5.3 Procedure, timing and outcomes

D0 = 2026-10-04. **Cutoff D0+9 = 2026-10-13, 23:59 UTC.**

1. **Preconditions:**
   - this file is merged to `main`;
   - C3, L7 (with its derivation record), E6, B3 and B4 are merged, or §5.2 applies;
   - B3's readout script emits every §3.4 criterion and verdict directly.
2. **Run:** `ai-engineer` dispatches the workflow (§6). It must start by D0+8 (2026-10-12) so that one invalid run
   can be repeated under §5.4 b. Runtime is unknown until B4; ~45 min was measured for the B2 harness. If the
   runner time limit requires it, variants or pairings are split into separate jobs with identical inputs. Splitting
   is not a parameter change.
3. **Evaluate:**
   - The readout script computes the verdicts mechanically.
   - `game-designer` checks them against this file and applies §5.1.
   - Nobody re-labels a criterion's class, threshold or CI rule after seeing the results.
4. **Record by the cutoff:**
   - the decision in the sprint file's decision log (task BC);
   - an append to §8 here, linking the results JSON and the digest.
5. **Outcomes** (exactly one):
   - **v2 ships.** `engineRulesVersion` 2 is pinned for the playtest with the chosen constants. Next:
     - R4: rules PR GAME_RULES 0.4 (decision note §6, with R-SCORE-003 set to the chosen values);
     - T-8 start-square visual and copy;
     - freeze of `replays/v2`.
   - **v1 fallback, B-01 risk recorded.** Taken if no candidate passes, if no valid run exists by the cutoff, or
     on §5.2's failed confirmation. The playtest pins `engineRulesVersion` 1. The record states:
     - `v1`'s P-1 and S-1 values with their CIs (or "not measured" if no valid run exists, in which case the
       proxy's 52.23–53.38 % is cited);
     - the scope of the accepted risk: casual vs-bot play only, no ranked play and no leaderboard in Phase 1
       (§9.1-2);
     - the failing criteria per candidate;
     - the owner and sprint for a new pre-registered v2 attempt.
     T-2 and T-3 ship regardless (the gate only picks the version the build pins).
6. **Lexicon follow-through, whichever version wins.** If the pinned version fails an L criterion (P-3..P-6), the
   restated 11×11 trigger (decision note §9.1-1, read as C-10 and C-11) is evaluated on that run, and
   `product-strategist` and the product owner are notified. P-6 > 40 % also meets the literal top-20 trigger in
   BALANCE.md.

### 5.4 No re-runs with tweaked parameters

**Rule:** after any v2 result has been seen, nothing may be re-run with changed parameters under this
pre-registration. That covers the seed, match counts, variants, constants, bot parameters or budgets, the lexicon
commit, criteria, thresholds, CI rules and criterion classes. A changed run needs a **new pre-registration**:

- a new file version committed to `main` before that run;
- a **new master seed**;
- a changelog entry stating what changed and why.

The first run's results stay committed and are cited in the new file and in the digest. No result may be deleted
or overwritten.

Only two re-runs are allowed without a new pre-registration:

- **(a) Infrastructure failure** (runner crash, timeout, cancelled job). Re-run with identical inputs. Determinism
  means completed parts must reproduce byte for byte; the digest records the failure and any mismatch (a mismatch
  is an I-class failure).
- **(b) Invalid run (I-1..I-3 failure, or a defect in the simulator or readout script).** Fix the defect in a
  reviewed PR that changes no §2–§4 parameter, then re-run **every** variant with identical inputs. The digest
  records the defect, the fix commit and both runs. A "defect" never includes a metric definition that turns out to
  be unfavourable.

Tuning between runs is excluded. Examples: changing the Strategist budget after seeing B-07, adding a 0/2.5/5/10
variant, or swapping the lexicon commit for a later one.

## 6. Outputs and execution

- **Execution:** a GitHub Actions workflow triggered **only by `workflow_dispatch`**. It never runs on
  `pull_request` or `push`, and never in PR CI (sprint 3 decision: the balance check leaves PR CI). Owners:
  `ai-engineer` (script) and `devops-sre` (workflow). Inputs:
  - the code commit (§4.4);
  - the lexicon commit (§4.3);
  - the path of this file and its git blob SHA, which the workflow checks against the commit before it simulates.
- **Committed artefacts** (docs-only PR, `game-designer` + `ai-engineer`), in
  `docs/game/sim/2026-10-v2-balance-check/`:
  - `results.json`, machine-readable. It includes:
    - the pre-registration path and blob SHA;
    - the code and lexicon commits;
    - `lexiconVersion`, `profileId`, `definitionHash`;
    - `engineRulesVersion` per variant, `BOT_VERSION`, the Strategist budget;
    - the master seed;
    - per variant and pairing: every §3.4 metric as integers (bp or tenths), with CIs and per-criterion verdicts
      (PASS / FAIL / EXCUSED-L / EXCUSED-K / NOT-MEASURED);
    - the reported metrics;
    - the §5.1 outcome;
    - wall time.
  - `digest.md`: one page with the verdict table, the §5.1 decision path, the surprises against §1.2, and the
    risks.
  - `jobs.tsv`: the exact spec of every job.
- Raw per-match records are not committed (BALANCE.md protocol: gitignored except summaries). They must be
  reproducible from the committed inputs.

## 7. Risks

- **Strict B-01 bar.** Containing the whole CI in [48, 52] at n ≈ 10,000 requires a point estimate within about
  ±1.02 points of 50 %. If the true rate is 51.0 %, the chance of passing is only about 50 %. This is accepted:
  B-01 is a blocking invariant, and the v1 fallback is safe for a casual-only playtest.
- **The L/K excuse (§3.3)** stops a content or bot shortfall from forcing a version that is no better on that
  criterion. In return, it can let v2 ship with a known lexicon or bot miss. Each such miss is recorded and routed;
  it is never silent.
- **Strategist is unproven.** With its leave and blocking logic, B-01 and C-05 may land differently from the
  greedy proxy. That is the reason for this run; §5.2 covers a late Strategist.
- **Bots are not humans.** Playtest telemetry (T-9) re-reads B-01, C-10 and C-11 on humans. A human-side miss is
  a new decision, not a re-run of this one.
- **Diagnostics may be skipped** if B3 cannot mix a v1 layout with v2 letters. The D4 attribution is then shown
  only against `v1`, where the letters also differ.

## 8. Outcome

*(Append only, after the run: date, results path, outcome per §5.3, link to the sprint decision log.)*

## Changelog

- 2026-10-04 — `game-designer` — Pre-registration (sprint 3 task V1). Master seed `2026100400000e16`. Merged
  before any v2 run.
