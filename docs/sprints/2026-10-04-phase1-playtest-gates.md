# Sprint 3 (Phase 1) — Playtest gates

Status: **Closed 2026-10-06** (Q5 exit check in `2026-10-06-phase1-playtest-gates-exit-check.md`; P3 Hermes job, S4 and H1 carried over). Planned 2026-10-04. Previous sprint: `2026-10-03-phase1-bots-app-foundation.md` (closed 2026-10-04,
Q2). Inputs: the Q2 carry-over list, `docs/game/decisions/2026-10-b2-response.md` (D1–D4, T-1..T-9, §9.1), and the
product-strategist (scope) and solution-architect (prerequisites) planning reviews of 2026-10-04.

## Goal

**Close every playtest Stage 1 gate that the repo can close.** That means:

- lexicon batch 3 merged;
- Strategist merged;
- rules v1 or v2 chosen by a pre-registered `/balance-check`;
- E-1.5 slices S1–S3 playable in a flagged dev build.

Phase 1 exit (the internal playtest) is still gated by device, store and legal items that sit outside the repo
(§ Human asks).

## Success indicators (measured at the Q5 exit check)

1. **Batch 3 meets E-1.7 AC-14:**
   - ≥ 2,000 playable forms, of which ≥ 1,300 canonical;
   - validator: 0 errors and 0 open NEEDS_REVIEW;
   - 2–4-letter forms at 20–25 %, ≥ 30 two-letter forms;
   - the artefact passes the restated size gate (P7).
2. **Strategist meets B-07:** it beats Beginner v2 with a lower 95 % CI ≥ 60 %. It is also:
   - deterministic under its seed;
   - accepted by `apply` on 100 % of actions over ≥ 1,000 matches;
   - within its budgets: BG-5 ≤ 1 %, node p95 inside the provisional cap.
3. **Batch-3 readout (AC-20)** on a Strategist mirror with the chosen rules:
   - C-02 ≤ 15 %, C-10 ≤ 5 %, C-11 ≥ 90;
   - top-20 term share ≤ 40 %, C-05 ≤ 35 %;
   - B-01: 95 % CI within [48 %, 52 %] for v2, or the risk recorded for the v1 fallback;
   - BG-1/2a/3/4 at their restated targets.
4. **v1/v2 decision** recorded by **D0+9**, against the pre-registered pass list (V1).
5. **S1–S3 dev build:**
   - a scripted full match completes 100 % of the time;
   - engine/app score mismatches = 0;
   - 0 committed moves lost in a process-kill resume test;
   - EN/FR with no hard-coded strings;
   - bundle gate green.
6. Main green; `pnpm validate` passes; golden-immutability and Hermes golden checks are required in CI.
7. **H1** is measured on a device, or reported "not measured" with an interim Hermes-CLI estimate of `c_node`.

## Decisions (2026-10-04, reversible unless noted)

- **ADR-0014 "Multiple rules versions in one engine build"** comes before any v2 code. ADR-0013 §D6 (one version per
  build) and the §D5 lexicon↔constants coupling would otherwise make v1 replays unreadable and rule out the §9.1 v1
  fallback. This is one-way once v2 logs exist next to v1 logs.
- **ADR-0011 gap is intentional:** the number is reserved for protocol/event versioning (E-2.3). Housekeeping closed.
- **v1/v2 cutoff is D0+9.** If v2 has no passing `/balance-check` by then, the playtest ships v1 and accepts the B-01
  risk in casual vs-bot play only (§9.1). T-3 and T-2 ship regardless: the gate only picks the version the build pins.
- **Strategist provisional budget:** about 70,000 nodes, from the bots-api §6 formula with Node's measured
  `c_node` × a Hermes factor of 10, or from Hermes-CLI constants once P3 lands. One `BOT_VERSION` 2 bump covers
  Beginner `[16,6,2,1]`, Strategist and the budgets. Device numbers (H1) later mean `BOT_VERSION` 3. Bot goldens are
  pinned per (`BOT_VERSION`, `engineRulesVersion`).
- **Bots run on the JS thread** (gestures and drag on Reanimated UI-thread worklets) unless spike P5 shows dropped
  frames. ADR-0015 is written only if P5 picks a second runtime.
- **Expensive runs leave PR CI:** the balance check (~45 min) runs as `workflow_dispatch`, with results JSON and a
  digest committed. Strategist and v2 full runs go to nightly `test:full`. The gating full-match sample stays at
  about 250 matches.
- **Deferred to sprint 4:** S4 (unless the stretch lands), S5, S6, Stage 0 dogfood, the P-1 forced-pass rule, tech
  squares, the in-match Knowledge Card.
- **Dropped:** the 11×11 simulation, made moot by D1-c.

## Tasks

Order: contracts and specs (P*, V1, ST0) → implementations → readouts → exit. Tests come before code in every
implementation task.

| ID  | Task                                                                                                                                                                                                                                                                            | Owner agent                                         | Depends on                    | Acceptance criteria                                                                                                                                                                                                                                                                   | Size | Status                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------- |
| P1  | ADR-0014 multi-version rules registry, plus engine API note §4.1/§6/§15 for v2                                                                                                                                                                                                  | solution-architect, game-engine-engineer            | —                             | ADR accepted. `RulesSet` keyed by `engineRulesVersion`; `LayoutId`/`LetterTableId` per version; draft-version rule (`createMatch` refuses a draft unless the simulator opts in; lint bans the opt-in in `apps/`); `gameValue` decoupling (T-6) specified; `replays/v1` never modified | M    | done (#57)                                                       |
| P2  | Close engine API Q1–Q7 (§20), including Q7 on-device persistence and resume                                                                                                                                                                                                     | solution-architect                                  | —                             | Answers recorded. Q7: the append-only log with `stateHashes` is the source of truth; snapshots only speed up resume (on hash mismatch, replay from the start); resume p95 ≤ 300 ms is an H1 target                                                                                    | S    | done (#57)                                                       |
| P3  | Golden-immutability CI check + Hermes golden job (ADR-0013 §D8.2)                                                                                                                                                                                                               | devops-sre, mobile-engineer                         | —                             | Editing `replays/v1/**` fails CI. The Hermes CLI at the SDK 57 pin runs rng/sha256/jcs/replay goldens and diffs them against Node as a required check. It also reports interim Hermes constants for P6                                                                                | M    | partial: golden immutability done (#58); Hermes job carried over |
| P4  | `.clxi` format-1 freeze trigger made explicit (lexicon-index §3.3)                                                                                                                                                                                                              | lexicon-engineer, solution-architect                | —                             | Trigger: the first build installed outside CI, or the first exported log. Pre-freeze checklist done; reserved flag bits stay `UNSUPPORTED_FORMAT`                                                                                                                                     | S    | done (#70)                                                       |
| P5  | Spike: bots off the UI thread on Hermes (JS thread + UI worklets vs a worklets background runtime)                                                                                                                                                                              | mobile-engineer, ai-engineer                        | —                             | 1-day spike; written result. Input stays responsive during a 2 s compute; decisions identical to Node. ADR-0015 only if a second runtime is chosen                                                                                                                                    | S    | done (#69), device check in H1                                   |
| P7  | Restate the lexicon size gate above 2,000 forms + irregular-plural confirmation mechanism (AC-14)                                                                                                                                                                               | lexicon-engineer, mobile-engineer                   | —                             | New gate (bytes per form or a batch-3 ceiling) with a pre-agreed switch rule to f0, decided together with P6. NEEDS_REVIEW confirmations stored as data; the 6 open warnings are confirmed or fixed                                                                                   | S    | done (#59)                                                       |
| P8  | `inflections: none` profile option (E-1.7 D-14)                                                                                                                                                                                                                                 | lexicon-engineer                                    | —                             | Lives in the profile and its `definitionHash`. AC-20 with/without inflections runs on real builds, not on the simulator's stripping                                                                                                                                                   | S    | done (#70)                                                       |
| P9  | Threat model: S1 on-device persistence and "Send match log"                                                                                                                                                                                                                     | security-engineer, privacy-compliance               | P2                            | STRIDE note covering seed/log handling, no PII in exports, tamper response; owner tasks created                                                                                                                                                                                       | S    | done (#67)                                                       |
| ST0 | `/feature-spec` Strategist (`docs/specs/E-1.3-bots/strategist.md`) + bots-api §5.x                                                                                                                                                                                              | ai-engineer, game-designer                          | —                             | Persona; leave, blocking and chain terms as integers; ST-x simulator targets; B-07 ≥ 60 % vs Beginner v2 pre-registered; human-win guardrail 20–50 %; kill switch `bots.strategist.enabled`; provisional-budget assumption stated                                                     | M    | done (#61)                                                       |
| V1  | Pre-registered v2 `/balance-check` pass list (E-1.6)                                                                                                                                                                                                                            | game-designer                                       | —                             | Written before any v2 run, in `docs/specs/E-1.6-balance/v2-balance-check.md`. Criteria: B-01 within [48, 52], C-05, C-10, C-11, C-02, B-07; D3 rule (0/3/6/12 if it holds, else 0/2/4/8); 10,000 paired matches per variant                                                           | S    | done (#56)                                                       |
| SP1 | Spec fold-ins: E-1.5 AC-3/AC-5 (F-1/F-2: R-SCORE-009, tech squares off by flag, pinned `engineRulesVersion`); E-1.7 C-10/C-11 guardrail and C-02 primary KPI (T-7); analytics catalogue (`app_backgrounded`, `app_opened.previous_exit_unclean`, `bot_*`, T-9 bag count at end) | product-strategist, game-designer, data-analyst     | —                             | Specs updated and reviewed; catalogue entries validated; privacy-compliance FYI on the new fields                                                                                                                                                                                     | S    | done (#60)                                                       |
| C3  | Lexicon content batch 3 (T-5 steering)                                                                                                                                                                                                                                          | lexicon-curator                                     | P7                            | AC-14 in full: ≥ 2,000 forms, ≥ 1,300 canonical, 2–4-letter forms 20–25 % (target ≈ 24 %), 0 NEEDS_REVIEW, category/difficulty bands held; split into stacked PRs of ≤ 200 terms; size gate green                                                                                     | L    | done (#62)                                                       |
| E6  | `engineRulesVersion` 2 draft constants in the registry (T-3) + "R-TURN-004 always terminates" property                                                                                                                                                                          | game-engine-engineer                                | P1                            | v1 behaviour and GC-DET-01 unchanged. v2 = `classic-v2` plain start + term bonus candidates 0/3/6/12 and 0/2/4/8, as a draft. `letters-v2` slot filled by T-4a                                                                                                                        | M    | done (#63)                                                       |
| B3  | Simulator v2 support (T-2) + same-vocabulary greedy yardstick + new metrics (C-10, C-11, bag count at end)                                                                                                                                                                      | ai-engineer                                         | P1, E6                        | Simulator runs v1 or draft v2 by flag; BG-2a/2b reported; readout script produces the V1 criteria directly                                                                                                                                                                            | M    | done (#65)                                                       |
| B4  | Strategist implementation + `BOT_VERSION` 2 (Beginner `[16,6,2,1]`, T-1) + cheaper key build                                                                                                                                                                                    | ai-engineer                                         | ST0, P6 decision in ST0, P7   | Spec ST-x targets met in simulation; B-07 ≥ 60 % (lower CI); deterministic; 100 % of actions accepted by `apply`; budgets respected; goldens pinned per (`BOT_VERSION`, `engineRulesVersion`)                                                                                         | L    | done (#66)                                                       |
| L7  | `letters-v2` derivation from batch-3 letter counts (T-4a) + `gameValue` coupling per ADR-0014 (T-6)                                                                                                                                                                             | game-designer, lexicon-engineer                     | C3, P1                        | Derivation recorded and reproducible; v2 draft table filled; `lexiconVersion` effect documented                                                                                                                                                                                       | S    | done (#64)                                                       |
| BC  | v2 `/balance-check`: Strategist mirror, 10,000 paired matches per variant, `workflow_dispatch`                                                                                                                                                                                  | game-designer, ai-engineer                          | V1, B3, B4, L7                | Results JSON + digest committed; V1 pass list evaluated; **v1/v2 decision recorded by D0+9**                                                                                                                                                                                          | M    | done (#68, #71)                                                  |
| R4  | If v2 is chosen: rules PR GAME_RULES 0.4 (b2-response §6) + T-8 start-square visual and copy + freeze `replays/v2`                                                                                                                                                              | game-designer, game-engine-engineer, ux-ui-designer | BC                            | v2 frozen (no longer a draft); traceability gate green; `replays/v2` golden pinned; Hermes job covers v2                                                                                                                                                                              | M    | not triggered (v1 fallback)                                      |
| S1  | E-1.5 slice S1: Home → PLAY NOW → full match vs Beginner (Skia board, `useLexicon()`), flag `play_vs_bot.enabled`                                                                                                                                                               | mobile-engineer, ux-ui-designer                     | P2, P3, P5                    | Scripted full match completes; engine/app score mismatches = 0; EN/FR; reduced motion; Skia JS cost measured and the bundle budget revised with explicit approval                                                                                                                     | L    | done (#73)                                                       |
| S2  | E-1.5 slice S2: match HUD, scores, rack interactions, end screen (AC-3/AC-5 as folded in SP1)                                                                                                                                                                                   | mobile-engineer, ux-ui-designer                     | S1, SP1                       | Spec ACs met behind the flag; a11y labels; no hard-coded strings                                                                                                                                                                                                                      | M    | done (#74)                                                       |
| S3  | E-1.5 slice S3: on-device action log + resume (AC-11) per P2 Q7                                                                                                                                                                                                                 | mobile-engineer                                     | S1, P2, P9                    | Process-kill resume test loses 0 committed moves; on hash mismatch, replay from the start; "Send match log" per P9                                                                                                                                                                    | M    | partial (#75): "Send match log" moved to S6                      |
| S4  | Stretch: S4 Strategist opponent + selector                                                                                                                                                                                                                                      | mobile-engineer                                     | B4, S2                        | Opponent chosen per spec; budget respected in-app                                                                                                                                                                                                                                     | M    | carried over to sprint 4                                         |
| H1  | Carry-over: engine, index and bot timings on Hermes + a real low-end Android                                                                                                                                                                                                    | mobile-engineer, devops-sre                         | device + EAS org (human asks) | `has()` ≤ 20 µs p99, `apply` < 10 ms, one Beginner and one Strategist move within budget, resume p95 ≤ 300 ms; if no device, an interim Hermes-CLI report from P3                                                                                                                     | S    | blocked, carried over                                            |
| X1  | Audit exceptions due 2026-11-02 (node-forge, braces) + uuid advisory row                                                                                                                                                                                                        | security-engineer, mobile-engineer                  | —                             | Each exception renewed with fresh evidence or removed by upgrade; uuid recorded or fixed                                                                                                                                                                                              | S    | done (#72, #76)                                                  |
| Q5  | Sprint exit check                                                                                                                                                                                                                                                               | qa-engineer                                         | all above                     | Indicators measured and recorded here; main green; `pnpm validate` passes                                                                                                                                                                                                             | S    | done (exit check)                                                |

**Critical path:** C3 (L) → L7 → E6/B3 → BC (needs B4) → R4. The playtest-build decision is due by **D0+9**. B4
runs on a parallel path of similar length; if either slips, the playtest ships v1 (§9.1).

## Human asks (product owner)

| By    | Ask                                                                                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D0+1  | Confirm the bundle id / package name (assumed `com.codelex.app`; permanent on Google Play once uploaded)                                                      |
| D0+1  | Create the Expo/EAS organisation. With one device, this is all H1 needs: a sideloaded dev APK requires no store account                                       |
| D0+2  | Confirm, or submit, the Apple and Google organisation enrolments (D-U-N-S). These take 1–3 weeks and are the likely critical path                             |
| D0+3  | Get one Galaxy A0x-class phone (Android 10+, 2–3 GB RAM) to a team member; 3–5 reference devices before T−2 weeks                                             |
| D0+3  | Fill the consent placeholders (legal entity, privacy contact, mailbox domain) and send the 3 `LEGAL_REVIEW_REQUIRED` items to counsel. Answer needed by D0+14 |
| D0+5  | Name the Dakar community and French school contacts                                                                                                           |
| D0+15 | Decide where the privacy policy URL is hosted (needed for TestFlight external testing)                                                                        |

The realistic playtest date T is the latest of three dates:

- the end of sprint 4 (S4–S6 + Stage 0);
- account verification + about 3 weeks;
- counsel's answer + 4 weeks.

## Risks

1. **Batch 3 throughput** (≈ +312 canonical terms with EN/FR definitions). Everything downstream slips with it. Do
   not lower the 2,000 target without a readout.
2. **Strategist budget without device data.** The cap may make it too weak for B-07, or too slow on a device.
   Mitigations: cheaper generation, Hermes-CLI constants (P3), budget changed only through `BOT_VERSION`.
3. **Lexicon size gate** (189 B/form today; the 0.55 MB gate breaks near 2,900 forms; GADDAG growth is super-linear).
   The f0 fallback costs ~1.5× generation time, which feeds back into the Strategist budget. P7 and ST0 decide this
   together.
4. **CI time:** about 4 min serialized today. Keep the gating sample small; put full runs in nightly/dispatch; set
   per-package time budgets.
5. **Bundle size:** Android is at 87 % of its limit and Skia arrives in S1. Measure it in the S1 PR. The Skia store
   download size needs an EAS build, which is a release gate.
6. **Store and legal lead time** sets the playtest date T, not code.
7. **Proxy risk:** the batch-3 numbers so far come from synthetic forms. The pre-registered V1 check covers this.

## Decision log

- 2026-10-04: Sprint planned. ADR-0014 required before v2 code. ADR-0011 gap confirmed intentional. v1/v2 cutoff
  D0+9. Strategist provisional budget ≈ 70k nodes under `BOT_VERSION` 2. Bots stay on the JS thread unless P5 says
  otherwise. Balance check moved out of PR CI.
- 2026-10-05 (task BC, by the D0+9 cutoff): **v1 fallback, B-01 risk recorded.**
  - Run: registered [Actions run 37288067161](https://github.com/Dev0cb/codelex/actions/runs/37288067161), green,
    I-1..I-3 hold. Results and digest are in `docs/game/sim/2026-10-v2-balance-check/`; the outcome is appended to
    spec §8.
  - §5.1 path:
    - `v2-3612` fails P-2 (C-05 upper CI 36.36 % > 35 %);
    - `v2-248` fails P-1 (B-01 upper CI 52.12 % > 52 %);
    - rule 3 applies.
  - The playtest pins `engineRulesVersion` 1, and `PLAY_RULES_VERSION` stays 1. T-2 and T-3 ship regardless.
  - R4 is not triggered (v1 fallback): no GAME_RULES 0.4 PR, no T-8, and `replays/v2` is not frozen.
  - Accepted risk:
    - v1 B-01 is 52.34 % [51.36, 53.33] on the Strategist mirror and 51.27 % [50.28, 52.25] on the Beginner mirror;
    - this is accepted for casual vs-bot play only, with no ranked play and no leaderboard in Phase 1 (§9.1-2).
  - v1 passes P-3..P-6, so no lexicon trigger applies.
  - The committed `results.json` is a deterministic local reproduction, because the CI artifacts are unreachable
    from the evaluation environment. `ai-engineer` owns the open sha256 check against the CI artifact.
  - Next pre-registered v2 attempt: `game-designer`, Phase 1 sprint 4, with a new file version and a new master
    seed.
- 2026-10-06 — Q5 exit check (`2026-10-06-phase1-playtest-gates-exit-check.md`): the repo-side gates are closed with
  stated gaps. `main` at `74288b2` is green. Carried over: the P3 Hermes golden job, S4, H1, the S3 "Send match log"
  (now S6), the v2 re-attempt and the open owner asks.
