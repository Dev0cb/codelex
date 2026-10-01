---
name: balance-check
description: Evaluate a balance change (scoring, tile distribution, Tech Power, Arena damage, bot strength, time controls) by large-scale bot-vs-bot simulation against the targets in docs/game/BALANCE.md. Use before merging any rule or value change that affects outcomes.
argument-hint: "<change to evaluate>"
---

# Balance check

Change: $ARGUMENTS

1. `game-designer` states the hypothesis and which invariants in `docs/game/BALANCE.md` could move.
2. `game-engine-engineer` runs the simulator for baseline and variant with identical seeds
   (≥ 10,000 games per mode × relevant bot pairings), e.g.
   `pnpm --filter @codelex/game-engine sim --mode classic --games 10000 --seed 42 --variant <name>`.
3. Report a comparison table: first-player win rate, mean/σ score, game length, power usage and usage→win lift,
   max single-turn damage share (Arena), median move time (Blitz bots), with 95% CIs.
4. Verdict per invariant (PASS/FAIL). Any FAIL blocks the change unless the human accepts a new target, which is
   then recorded in `docs/game/BALANCE.md` changelog.
