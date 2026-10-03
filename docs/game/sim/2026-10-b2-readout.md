# B2 simulator readout — lexicon batch 2, Beginner calibration, first-player advantage

- Date: 2026-10-03 · Author: ai-engineer · Sprint: `docs/sprints/2026-10-03-phase1-bots-app-foundation.md` (B2)
- For: game-designer (BALANCE.md targets, BG-1..BG-5 confirmation), product-strategist (B-01 exit criterion),
  lexicon-curator / lexicon-engineer (E-1.7 AC-20)
- Data: `docs/game/sim/2026-10-b2-report.json` (full aggregates; sha256 `59411190…a2e070`)
- Simulator: `packages/bots/sim/` (README "Simulator (B2)"); bots contract `docs/architecture/notes/bots-api.md`

## Reproduce

```bash
git checkout b10767a214734106caa737079f222f47b2efdbf0   # feat(bots): B2 simulator CLI (branch feat/bots-b2-simulator)
pnpm install --frozen-lockfile
pnpm turbo run build --filter=@codelex/bots...
cd packages/bots
time pnpm simulate -- --mirror 10000 --pair 1000 \
  --out sim-results/2026-10-b2-report.json --markdown sim-results/2026-10-b2-tables.md
```

- Master seed `2026100300000b02`. Match `i` of pairing `p` uses the seed derived from the stream
  `sim-match:<p>:<i>` (two `next()` words as 16 hex chars). Pairings, with inflections: 0 = Beginner mirror (10,000),
  1 = Beginner vs random-legal (1,000), 2 = greedy vs Beginner (1,000). Without inflections: 0 = Beginner mirror
  (10,000). The two mirrors use the same seeds, so they are a paired comparison. Personality A sits on seat 0 in
  even matches and on seat 1 in odd ones. The engine draws the first seat from the `first-player` stream.
- Bots get `deriveRng(seed, "bot:<seat>:<n>")`, `BOT_VERSION` 1, default budgets, GADDAG path. Lexicon
  `4fa5884050b4ea53` (current main data, 1,501 forms / 988 terms) is built as a `.clxi` with the GADDAG section and
  decoded. Rules: `engineRulesVersion` 1, `classic-v1`, `letters-v1`, 1v1 `untimed-vs-bot`.
- The JSON report has no wall time and is byte-identical across runs; this was checked by running an 800-match
  suite twice. Wall time: 22,000 matches in 9 min 20 s, about **39 games/s** on one Node 22.22 thread (4 vCPU
  shared host, load ≈ 5).
- **Every match was replayed** with `replay` against the per-action state hashes and the final hash: 22,000 / 22,000
  identical. Every bot action was accepted by `apply` (P-BOT-01 at scale: 1,217,158 decisions). Logs stay in memory
  and are never written. Game-engine API note Q1/Q2 therefore stay two-way.
- Without inflections = a simulation-only profile `global-no-inflections` (same terms, no inflection forms, own
  definitionHash `00d1ebcc16bb3489`). **Missing in the lexicon tooling:** the build-time profile option
  `inflections: all | none` (E-1.7 D-14) does not exist yet. The simulator strips inflections from the canonical
  document itself (owner of the real option: lexicon-engineer).

## Headline

| Indicator | Target | Result (95 % CI) | Verdict |
|---|---|---|---|
| B-01 first-player win, Beginner mirror (draws excluded) | ≤ 52 % | **52.35 %** [51.36, 53.33] (5,196 / 9,926; 74 draws) | **borderline**: point estimate above 52 %, CI includes it |
| C-08 first-mover mean lead | ≤ 8 points | 4.9 points | ok |
| BG-1 Beginner vs random-legal | ≥ 80 % | **64.48 %** [61.44, 67.40] | **miss** |
| BG-2 greedy vs Beginner | 65–85 % | **98.80 %** [97.91, 99.32] | **miss** (Beginner far too weak against greedy) |
| BG-3 Beginner ÷ greedy points per word | 55–75 % | 13.3 ÷ 20.9 = 63.6 % | ok |
| BG-4 Beginner novice/intermediate main words | ≥ 90 % | 87.73 % (mirror), 90.25 % (vs greedy) | **slight miss** |
| BG-5 Beginner `budgetExhausted` | ≤ 1 % | 0 of 553,873 decisions (nodes p95 2,525, max 92,502) | ok |
| Scoreless endings (R-TURN-004) | ≤ 10 % (E-1.7; BALANCE 11×11 trigger) | **99.57 %** (9,957 / 10,000) | **trigger** |
| No-legal-word turns, equal bots | ≤ 25 % batch 2, ≤ 15 % batch 3 (C-02) | 18.70 % all turns; 13.61 % while the bag holds tiles | ok for batch 2 |
| Top-20 terms share of words played | ≤ 40 % (E-1.7, BALANCE trigger) | 39.78 % | at the limit |
| Mean total score / words per match | (reported) | 583.2 points / 45.0 words | — |
| C-03 mean points per accepted word | 15–30 (Strategist mirror) | Beginner 13.7, greedy 20.9 | below for Beginner |
| C-05 term-bonus share of points | ≤ 35 % | 37.27 % (mirror), 44.20 % (greedy vs Beginner) | **miss** |
| C-09 hooked-inflection term-bonus share | ≤ 10 % | 4.77 % | ok |
| Inflection share of words played | 10–25 % expected | 6.23 % | low |

End reasons (Beginner mirror, with inflections): `going_out` 43, `scoreless_turns` 9,957, `resign` 0. At the end
the bag is empty in only 53.22 % of matches, and both racks are still full (14 tiles, p50 and p95). The other
pairings look the same: 99.50 % scoreless endings (vs random-legal) and 99.40 % (greedy vs Beginner).

## AC-20 — with vs without inflections (Beginner mirror, same 10,000 seeds)

| KPI | With inflections (1,501 forms) | Without (988 forms) | Lift from inflections |
|---|---|---|---|
| No-legal-word turns (all turns) | 18.70 % | 19.88 % | −1.18 pt |
| No-legal-word turns (bag not empty) | 13.61 % | 15.91 % | −2.30 pt |
| Scoreless endings | 99.57 % | 99.76 % | −0.19 pt |
| Bag empty at the end | 53.22 % | 43.19 % | +10.0 pt |
| Top-20 terms share | 39.78 % | 38.94 % | +0.84 pt |
| Inflection share of words | 6.23 % | 0 % | — |
| C-09 hooked-inflection term bonus | 4.77 % | 0 % | — |
| C-05 term-bonus share | 37.27 % | 38.96 % | −1.69 pt |
| First-player win (draws excluded) | 52.35 % [51.36, 53.33] | 52.92 % [51.93, 53.90] | −0.57 pt (not significant) |
| Mean total score / words per match | 583.2 / 45.0 | 545.2 / 44.3 | +38.0 / +0.7 |

Inflections help: matches run further (the bag empties 10 points more often) and fewer turns are wordless while
tiles remain. The help is small next to the main problem, which is that almost every match ends on scoreless turns.

## Interpretation and flags

1. **The board locks up (thin-lexicon signal): game-designer and lexicon-curator.** 99.6 % of matches end on six
   consecutive scoreless turns. Half of them end with tiles still in the bag, and both players hold full racks.
   This is not a few unplayable leftover letters at the end: the board runs out of places where any word from this
   lexicon fits, and every rack is stuck. BALANCE.md's 11×11 fallback rule ("> 10 % of games ending on scoreless
   turns") is triggered by a wide margin. The rule is measured with Strategist mirrors at ≥ 2,000 forms (E-1.6),
   so this is an early warning, not the formal trigger. The greedy pairing shows the same rate, so playing better
   does not fix it. Inputs for the decision: batch 3 content (more 2–4-letter connectors and hooks; inflections only
   moved the bag-empty rate from 43 % to 53 %), a simulated 11×11 variant, and the R-TURN-004 limit. One option to
   simulate: should an exchange count as scoreless when the bag can refill the rack? Today a bot with no word and a
   full bag exchanges, and three such turns per seat end a match that still has tiles in the bag.
2. **First-player advantage: product-strategist and game-designer.** 52.35 % [51.36, 53.33] over 9,926 decisive
   mirror matches. The point estimate is above B-01's 52 % and the interval contains it, so B-01 is neither met nor
   clearly broken. The protocol asks for a Strategist mirror (next sprint) on the ≥ 2,000-form lexicon. The mean
   first-mover lead (4.9 points) is within C-08. Without inflections the rate is 52.92 % [51.93, 53.90]; the
   paired difference is not significant. Re-measure with Strategist and batch 3 before deciding on a start-square
   or second-mover compensation.
3. **Beginner calibration misses BG-1 and BG-2: game-designer (confirm targets or tune).** Against random-legal
   Beginner wins only 64.5 %, and against greedy it loses 98.8 %. Two causes show in the data:
   - The candidate sets are tiny. After the vocabulary filter, Beginner chooses among p50 3 and p95 22 moves per
     decision, so a uniform pick among the legal moves is close to a weighted top-5 pick. Random-legal's 12.8
     points per word is close to Beginner's 13.9.
   - The vocabulary filter costs Beginner the term bonus. Term bonus makes up 37–44 % of all points (C-05 miss),
     and harder terms carry bigger bonuses (R-SCORE-003: advanced +8, expert +16). Random-legal and greedy play advanced/expert main words freely (39 %
     and 59 % of their words), while Beginner almost never does.

   Tuning levers (bots-api §5.4, each a data change plus a `BOT_VERSION` bump, not done here): `maxDifficultyRank`
   1 → 2, flatter or sharper `topWeights`, and BG targets restated for a lexicon where few moves exist. BG-3
   (63.6 %) and BG-5 (0 exhaustion) pass. BG-4 (87.7 %) misses because the filter falls back to the unfiltered set
   when no easy word exists. The fallback works as specified (§5.3 step 1); with a richer lexicon the miss should
   shrink. Human target (F-9, human win ≥ 55 %): a Beginner that loses 99 % to greedy is probably beatable by a new
   human, but only the playtest can tell.
4. **Term bonus weight (C-05 37–44 % vs ≤ 35 %): game-designer.** This drives both the BG-1/BG-2 shape and the
   points-per-word gap. It is a scoring constants question for E-1.6, recorded here as a first signal.
5. **Inflections are played less than expected** (6.2 % vs 10–25 %). The C-09 hook tripwire is far from firing
   (4.8 % ≤ 10 %).
6. **Pending from E-1.7:** the `inflections: none` profile option (lexicon-engineer). AC-20 also asks that this
   readout be linked from the sprint file (orchestrator).

## Not covered here

- Strategist (next sprint), 11×11, the ≥ 10,000-games-per-variant protocol for every pairing (only the mirrors
  reached it), human calibration (playtest), and DAWG-path matches. P-BOT-03 makes the DAWG path's decisions
  equal to the GADDAG path's whenever no budget binds, and BG-5 shows that no Beginner budget bound in this run.
- Game-engine API note §20 Q1–Q7 (solution-architect) are still open. B2 does not persist action logs, so none of
  them became one-way. They must be closed before the first log is written to disk (E-1.5 "Send match log", Phase
  2 `services/game`).
