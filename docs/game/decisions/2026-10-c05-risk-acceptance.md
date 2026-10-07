# C-05 decision: v1 term-bonus share accepted as a Phase 1 risk, target unchanged

- Date: 2026-10-07. Author: `game-designer`, deciding as the owner of `docs/game/BALANCE.md`. Sprint 4 task G1
  (`docs/sprints/2026-10-07-phase1-dogfood-readiness.md`).
- Responds to: Q5 exit check finding S2 and indicator 3 (`docs/sprints/2026-10-06-phase1-playtest-gates-exit-check.md`).
- Evidence (no new simulation was run):
  - `docs/game/sim/2026-10-v2-balance-check/` (`digest.md`, `results.json`, master seed `2026100400000e16`);
  - `docs/game/decisions/2026-10-b2-response.md` §4 (D3) and §9.1-2.
- Rules baseline: GAME_RULES 0.3.1, `engineRulesVersion` 1, term bonus 0/4/8/16 (R-SCORE-003), `BOT_VERSION` 2.
- **Status: decided.** No BALANCE.md target changes, so product-owner confirmation is not required. The product owner
  is informed through the sprint 4 exit check (Q6).

## 1. Decision

Option (a): **explicit risk acceptance. C-05 stays ≤ 35 %.**

The v1 term-bonus share is C-05 = **43.11 % [43.04, 43.18]** on the Strategist mirror. This miss is accepted for
Phase 1 under these conditions:

- the scope is **casual play against bots only**: no ranked play, no leaderboard, no tournament, no Daily, and no
  other surface that compares players;
- the scope is the same as the B-01 acceptance (decision note `2026-10-b2-response.md` §9.1-2, BC digest "v1 fallback
  record");
- the acceptance expires at the earliest re-evaluation trigger in §5.

The target is not restated (option b, rejected in §3).

## 2. What C-05 protects

C-05 keeps CODELEX a **word game about the board** in which tech knowledge earns extra points. It stops the game from
becoming a jargon quiz played on a grid. It enforces two pillars:

- **Pillar 1** (strategy stays central): placement, premiums, leave and blocking must decide most matches.
- **Pillar 3** (knowledge is rewarded, not required): a player who knows only common terms can still compete and
  enjoy the game.

Evidence from the v1 readout (`results.json`, `v1` variant):

| Pairing                  | Matches | C-05 (v1, 0/4/8/16)    | C-05 (v2-248, 0/2/4/8) |
| ------------------------ | ------- | ---------------------- | ---------------------- |
| Strategist mirror (P-2)  | 10,000  | 43.11 % [43.04, 43.18] | 25.84 % [25.78, 25.90] |
| Beginner mirror          | 10,000  | 37.09 % [37.02, 37.16] | 21.75 % [21.69, 21.80] |
| Strategist vs Beginner   | 2,000   | 40.34 %                | 24.00 %                |
| Beginner vs random-legal | 2,000   | 40.70 %                | 25.44 %                |

| Vocabulary gap, same search (aWin vs Beginner) | v1                     | v2-248                 |
| ---------------------------------------------- | ---------------------- | ---------------------- |
| greedy, Beginner vocabulary (BG-2a)            | 68.80 % [66.72, 70.81] | 67.00 % [64.90, 69.04] |
| greedy, full vocabulary                        | 95.20 % [94.17, 96.06] | 92.32 % [91.06, 93.41] |
| lift from vocabulary alone                     | +26.4 points           | +23.3 points           |

How I read these numbers:

1. **v1 misses C-05 in every pairing, including the Beginner mirror (37.09 %).** So the miss comes from the
   0/4/8/16 constants measured against the letter-value scale. It does not come only from expert play. Even weak play
   gets more than a third of its points from the term bonus.
2. **Most of the vocabulary advantage does not come from the bonus.** Halving the bonus reduces the lift by only
   about 3 points (+26.4 to +23.3). Longer words and more legal placements are the bigger factor. The bonus makes
   that advantage larger and more visible: on screen, an expert term shows "+16", about three quarters of a strong
   bot's mean points per word (greedy, 20.8 on batch 2, decision note D3). These are 2,000-match rows, only partially paired across variants, so read them as
   direction and rough size.
3. The target is reachable. `v2-248` meets C-05 with a wide margin and passes every L and K criterion. It failed only
   B-01, by 12 bp on the upper CI bound. **Rules cannot be changed within v1.** Cutting the bonus while keeping the DW
   start raises B-01 (decision note D3: 0/2/4/8 with DW gives 53.35 % on the batch-2 Beginner mirror, and the
   `dx-dw-248` Strategist diagnostic gives 54.06 %). The only fix is a v2 that passes both criteria.

## 3. Why accept and not restate

- **Restating the target to fit v1 would be fitting the target to the result.** The ≤ 35 % bar was set before any
  readout, against the letter scale (BALANCE.md step 4). A bar of about 45 % would pass v1 only because v1 is what
  shipped. It would also remove the criterion that drove D3 and that the v2 re-attempt needs.
- **No new evidence says 35 % is the wrong bar.** The only argument for a higher bar is that human players may enjoy a
  game that rewards knowledge heavily. That is a hypothesis for the playtest to test (§4). It is not a reason to
  change the target now.
- **Phase 1 limits the harm.** Without a ranking, a knowledge-heavy game cannot produce an unfair standing. The cost
  is limited to how the game feels, and that feel is exactly what the playtest measures. The dogfood testers are
  tech-literate, so they will feel the problem less than the target audience (see §6).
- **The acceptance is reversible and has an expiry date.** A restated target would stay in BALANCE.md until someone
  noticed it.

## 4. What the playtest watches

The term-bonus signals are diagnostics. They do not gate a Phase 1 stage. The exit KPIs stay as specified in E-1.5.

**Telemetry (S6a–S6c exports, read in KR by `data-analyst`)**

- **T-1: human term-bonus share, a proxy for C-05.** Computed from `bot_word_played` events with `actor = player`:
  Σ v1 bonus(`difficulty`) over events whose `bonus_flags` contain `term`, divided by Σ `points`.
  - Assumption: `difficulty` belongs to the main word's canonical term.
  - Cross-word bonuses are missed, so the proxy is a lower bound.
  - **Calibration:** compute the same proxy for `actor = bot`. Compare it with the simulated value for the pairing
    (Beginner mirror 37.09 %, Strategist vs Beginner 40.34 %). Use the bot-side ratio to correct the human value.
  - Report per tester and pooled.
- **T-2: difficulty mix of player words.** The share of advanced and expert words per tester, compared with win rate
  against Beginner and with `score_margin` (F-9). This answers whether testers who know fewer terms lose by large
  margins.
- **T-3: "would play again", split by T-2 tercile.** This uses the existing one-tap survey only (AC-18). No survey
  question is added.
- **T-4: C-09 hook share.** Reported only. The simulated value is 4.31 % (v1 Strategist mirror), within the ≤ 10 %
  target.

**Debrief interviews (`product-strategist`, a script addition only)**

- "When you lost, what decided it?" Code each answer as one of: board/letters, luck, or words I did not know /
  bonuses.
- "Did you ever skip a tech term because you were not sure it was valid, or play one you did not understand just for
  the bonus?"
- "Did the bonus numbers (+4/+8/+16) feel fair?"

**Escalation signals.** Any one of these signals raises the priority of the v2 re-attempt. None of them changes the
rules during the playtest, because `engineRulesVersion` is pinned.

- At least a third of the debriefed testers name "words I did not know / bonuses" as the main reason for their
  losses.
- The calibrated T-1 pooled value is above 43.11 % (the strongest bot's level).
- Testers in the lowest T-2 tercile answer "would play again" below the 70 % exit bar while the other terciles meet
  it.

## 5. Re-evaluation triggers (the acceptance ends at the first one)

1. **v2 re-attempt pre-registration.**
   - C-05 stays an R criterion: upper CI ≤ 35.00 % on the Strategist mirror.
   - The new file cites this note and the BC run as prior evidence.
   - The bar is not relaxed to admit v1.
   - It is decided together with B-01, never alone (D3).
2. **Phase 2 gate for ranked play, leaderboards, tournaments or the Daily.** v1 rules cannot run on any of these
   surfaces. They need a v2 that passes C-05, or a new decision confirmed by the product owner.
3. **A playtest escalation signal (§4).** game-designer re-reads the signal with `data-analyst` within one sprint of
   the readout.
4. **A lexicon release that shifts the difficulty mix toward advanced or expert terms** (beyond the batch-3 steering
   of 35/35/22/8 %). game-designer re-reads C-05 in the next `/balance-check`.
5. **End of Phase 1**, whichever of these comes first.

## 6. Risks

- **Tester bias.** Dogfood testers know tech vocabulary well. The playtest is therefore likely to _under_-report the
  "jargon quiz" feel that C-05 guards against. Read a lack of complaints as weak evidence.
- **Proxy limits.** T-1 misses cross-word bonuses, and testers are few. It shows direction only and supports no
  significance claim.
- **Two R misses at once.** B-01 at 52.34 % and C-05 at 43.11 % both point toward a game decided by things other than
  board skill. The playtest cannot separate the two effects.
- **Coupling with the v2 re-attempt.** Fixing C-05 alone makes B-01 worse. The re-attempt must handle both criteria,
  and it must account for the repeated look at 0/2/4/8 (BC digest, risk 3).

## 7. Hand-offs

| Who                  | What                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `data-analyst`       | T-1 to T-3 in the KR readout. Confirm the `difficulty` and `bonus_flags` semantics of `bot_word_played` (main word only?) |
| `product-strategist` | Add the three debrief prompts to the playtest debrief script. No new survey question                                      |
| `qa-engineer`        | Q6: close finding S2 by citing this note                                                                                  |
| `game-designer`      | v2 re-attempt pre-registration (trigger 1), after sprint 4                                                                |

`monetization-liveops` is not involved: there is no economy change. `game-engine-engineer` is not involved: there is
no rules change.
