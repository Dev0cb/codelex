---
name: feature-spec
description: Turn an idea into a reviewed CODELEX feature spec (problem, stories, Given/When/Then acceptance criteria, KPIs, analytics events, flags, rollout, risks). Use whenever a new feature, mode, power, season mechanic or B2B/EDU capability is proposed.
argument-hint: "<feature idea>"
---

# Feature spec

Idea: $ARGUMENTS

1. Delegate to `product-strategist` to draft `docs/specs/<epic>/<feature>.md` from `docs/templates/FEATURE_SPEC.md`.
2. In parallel, request reviews (each returns findings, not rewrites):
   - `game-designer` — always for gameplay; rule IDs to add to `docs/game/GAME_RULES.md`.
   - `ux-ui-designer` — flows, states, copy EN/FR.
   - `data-analyst` — events and KPI definitions.
   - `privacy-compliance` — only if personal data, minors, UGC, payments, public visibility.
   - `monetization-liveops` — only if economy, store, seasons, B2B/EDU.
3. Have `product-strategist` integrate the findings, mark open questions, and set status `Ready for design`.
4. Output: spec path, 5-line summary, open questions needing the human's decision (ask them with AskUserQuestion
   only if they block design).
