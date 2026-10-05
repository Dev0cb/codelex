# B4 readout: Strategist and `BOT_VERSION` 2 (2026-10-05)

- Owner: ai-engineer. Reviewers: game-designer (ST-x, ST-8 flag, tuning), data-analyst (definitions).
- Spec: `docs/specs/E-1.3-bots/strategist.md` (ST-x targets, pre-registration). Contract: bots-api §5.4–§5.6, §6.1.
- Data: `results.json` (every job, integers: basis points, tenths), `tuning-st2.json` (the ST-2 tuning runs).
- Tool: `pnpm --filter @codelex/bots simulate:b4 -- --job <id> --recheck 100` (`packages/bots/sim/b4*.ts`).

## Setup

| Item | Value |
|---|---|
| `BOT_VERSION` | 2 |
| `engineRulesVersion` | **1 only**. No v2-draft run was made (V1 pre-registration, spec § ST-x) |
| Lexicon | `main` at `2985c45`: batch 3 merged (C3, #62, commit `b3ab7bb`), `lexiconVersion` `e568477b5592a994`, 2,154 forms, `global-ranked` |
| Automaton | f1 (`.clxi` with the GADDAG section, what the app bundles). ST-1 also run on f0 |
| Tuning seeds | master `2026100400000a00`, pairings 0–4 |
| Confirmation seeds | master `2026100400000b07`, pairing 10, matches 0..1,999, seats swapped every other match |
| Checks | every match replayed to identical hashes; the first 100 matches of every job re-run to identical final hashes |

## Cheaper key build (step 1, `BOT_VERSION` 1)

Dedupe by packed integer signature, keys only for kept candidates. `decisions-v1.json` passed unchanged before the
bump. Node two-blank `c_node` on the 2,000-form synthetic fixture, same host and positions: GADDAG 0.84 → 0.77–0.80
µs, DAWG 1.31 → 1.27–1.33 µs. That is below the B2 basis (1.2 / 1.9 µs, loaded host) but within host noise of it, so
the §6 formula is **not** re-applied: the budget stays frozen at 70,000 / 500 (Strategist) on both automata. The
lower `c_node` is extra headroom against AC-8, not a reason to raise the cap.

## Final tuning values (frozen in `PERSONALITIES.strategist`)

| Field | Starting value | Frozen | Why |
|---|---|---|---|
| `topWeights` | `[10,6,3,1]` | `[10,6,3,1]` | ST-1b inside the band without a change |
| `maxDifficultyRank` | 2 | 2 | GD-1 |
| budget | 70,000 / 500 | 70,000 / 500 | GD-7, frozen |
| `denialEvenPermille` / `denialTrailPermille` | 1000 / 400 | **0 / 0** | ST-2: denial outside a lead cost strength (it closes the board for both sides); denial while leading (1500 ‰) keeps the F-8 behaviour and ST-4c |
| `exchangeMaxScore` (X-3) | 14 | **20** | ST-2: voluntary exchanges were the term that added the most strength |
| `exchangeGainDp` (X-5) | 150 | **120** | same; ST-4b stays inside 1–6 % (4.06 %) |
| leave, chain, other X values | — | starting values | leave ×0.5 / ×1.5 / ×2 and chain at the GD-6 ceiling were tried and did not help (`tuning-st2.json`) |

ST-2 on tuning seeds (4,000 matches per candidate), starting values 52.43 % → frozen 56.36 % [54.80, 57.90].
`exchangeGainDp` 100 gave 57.68 % but 5.39 % voluntary exchanges, too close to ST-4b's 6 % cap. These changes stay
inside the levers the spec names for ST-2 (leave and denial weights) and ST-4b (X-3..X-5); game-designer should
confirm the X-3/X-5 move, since GD-3 accepted the starting values.

## ST-x results

| ID | Metric | Value | Target | Pass |
|---|---|---|---|---|
| **ST-1** (confirmation, f1) | Strategist vs Beginner v2, win, draws excluded | **82.83 % [81.11, 84.43]** (1,650 / 1,992; 8 draws) | lower CI ≥ 60 % | **pass** |
| ST-1 (same seeds, f0) | same | 82.88 % [81.16, 84.48] | reported | — |
| ST-1b (tuning) | same pairing, point estimate | 82.24 % [80.49, 83.86] | 70–85 % | pass |
| ST-1b on confirmation | reported only | 82.83 % | reported | — |
| ST-2 | Strategist vs ablated Strategist, 2,000 | 55.56 % [53.36, 57.74] | point ≥ 55 %, lower CI > 50 % | pass |
| ST-3 | full-vocabulary greedy vs Strategist | 78.30 % [76.43, 80.06] | reported | — |
| ST-4a | mean `raw(leave)` after PLACE_WORD, bag ≥ 7, Strategist − greedy | −14.8 − (−64.8) = **+50.0 dp** | ≥ +30 dp | pass |
| ST-4b | voluntary exchanges ÷ Strategist turns with bag ≥ 7 | 4.06 % (ST-1b run), 4.27 % (ST-7 mirror); **0** with `scorelessTurns ≥ 3` | 1–6 %, 0 | pass |
| ST-4c | hot TW opened per move while leading, Strategist ÷ greedy | 0.065 ÷ 0.168 = **0.39** | ≤ 0.70 | pass |
| ST-4d | main words with `chainKAfter > 0`, Strategist ÷ greedy | 0.82 % ÷ 0.55 % = **1.49** | ≥ 1.25 | pass (small base rate, see below) |
| ST-5 | `budgetExhausted`, Strategist decisions; node p95 | 0.33–0.36 % in every run; p95 11,622–12,181 | ≤ 1 %; ≤ 35,000 | pass |
| ST-6 | legality and determinism | 32,000 matches, 100 % accepted by `apply`, every replay identical, 100-match re-runs identical in every job; 250-match PR smoke in `pnpm test` | 100 % over ≥ 1,000 | pass |
| ST-7 | C-10 premature lock (R-TURN-004 end with bag ≥ 7), Strategist mirror vs greedy mirror, 10,000 each, same seeds | 1.31 % vs 1.23 % (+0.08 points) | ≤ greedy + 1.0 point | pass |
| ST-7 | C-11 tiles played per match | 92.6 vs 92.9 (−0.3) | ≥ greedy − 1.0 | pass |
| ST-8 | first-player win, Strategist mirror − greedy mirror | 52.91 % [51.92, 53.89] − 51.89 % [50.91, 52.88] = **+1.02 points** | reported; > 1.0 ⇒ game-designer review before the data freeze | **flag** |

Notes:

- ST-7 passed, so the forced keep `K*` stays (no GD-3 revert to plain BOT-6).
- ST-4d: chain links are rare on batch 3 for every bot (under 1 % of main words), so the ratio rests on 331
  Strategist links in the ST-3 run. It is a real-relations reading (R-6), but a thin one.
- ST-8 is the one recorded miss of a review trigger: the gap is 1.02 points against a 1.0-point trigger, with
  intervals that overlap heavily. Recorded under AC-9 for game-designer sign-off before S4 enables the bot. If the
  review wants it lower, the lever is `denialLeadPermille` / `leadThreshold` (R-5), which needs a new confirmation
  run under the same master seed.
- Strategist two-blank decisions: 0.4 % of its decisions (1,976 of 493,070 in the ST-7 mirror); they carry 48 % of its `budgetExhausted`
  decisions (R-3).

## BG-5 re-read and the Beginner budget (GD-7)

| Run | Beginner decisions with a cap hit | Two-blank |
|---|---|---|
| Beginner mirror, tuning pairing 4, 2,000 matches | 1 (0.00 %) | 1 of 46 two-blank decisions |
| Strategist vs Beginner, tuning (ST-1b) | 0 (0.00 %) | 0 of 27 |

BG-5 ≤ 1 % holds on batch 3 at 70,000 / 300, so the 100,000 / 300 fallback is **not** applied. Beginner v2:
`topWeights` `[16,6,2,1]`, 70,000 / 300, every other field unchanged.

## What was not done here

- No v2-draft run (engineRulesVersion 2): BC reads B-07 and the V1 pass list with this Strategist as merged.
- No device or Hermes-CLI measurement (H1 / P3). AC-3's device clause stays "not measured on device".
