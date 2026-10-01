---
name: season-plan
description: Plan a CODELEX season end-to-end (theme, lexicon pack, missions, achievements, events, pass, cosmetics, Daily calendar, leaderboards, rewards, comms, KPIs, kill switches). Use for Season 01 The Cloud, 02 Artificial Intelligence, 03 Cyber War, 04 The Web and beyond.
argument-hint: "<season number and theme>"
---

# Season plan

Season: $ARGUMENTS

1. `monetization-liveops` drafts `docs/liveops/seasons/SXX.md` from the season kit in its agent definition.
2. In parallel: `lexicon-curator` builds the season word pack (run `/lexicon-add`), `game-designer` designs
   challenges/missions and any seasonal rule twist (then `/balance-check`), `ux-ui-designer` defines the visual
   theme and cosmetics briefs, `data-analyst` defines KPIs and the readout plan, `privacy-compliance` checks
   rewards/contest rules.
3. Verify everything is remote-configurable (no app release needed) and every new mechanic has a kill switch.
4. Output the season doc, the content checklist with owners, and the launch timeline (T-6w → T+2w).
