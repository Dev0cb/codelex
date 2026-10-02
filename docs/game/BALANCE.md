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
1. Count letter frequency `f(l)` across all playable forms of the profile, weighted by term frequency class.
2. Tile count `n(l) = max(1, round(98 × f(l)))` adjusted so the bag totals 100 with 2 blanks.
3. Letter value `v(l)` = clamp(1, 10, round(k / f(l)^0.5)) with `k` tuned so E,A,I,O,N,R,S,T = 1.
4. Freeze per `lexiconVersion`; changes require a new version and `/balance-check`.

## Simulation protocol
- ≥ 10,000 games per variant, identical seed sets for baseline and variant, seats swapped half the time.
- Report mean ± 95% CI; use paired comparisons on shared seeds.
- Simulation outputs saved to `packages/game-engine/sim-results/<date>-<variant>.json` (gitignored except summaries).

## Board-size fallback (product owner decision, 2026-10-02)
An 11×11 "Quick Classic" variant (~60-tile bag) is simulated alongside 15×15 and may ship behind a flag for the
E-1.5 playtest **only if** the 15×15 simulation shows any of: > 10 % of games ending on scoreless turns
(R-TURN-004), > 15 % of turns with no legal word, or the 20 most-played terms making up > 40 % of words played.
It is never used for ranked play.

## Changelog
- 0.2 — 2026-10-02 — Added the measured 11×11 fallback rule (product owner decision). Invariants unchanged.
- 0.1 — Initial targets.
