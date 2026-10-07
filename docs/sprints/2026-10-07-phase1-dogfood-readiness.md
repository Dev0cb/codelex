# Sprint 4 (Phase 1) — Dogfood readiness

Status: **Planned 2026-10-07.** Previous sprint: `2026-10-04-phase1-playtest-gates.md` (closed 2026-10-06, Q5 exit
check in `2026-10-06-phase1-playtest-gates-exit-check.md`). Inputs: the Q5 carry-over list and risks, the Android
preview build (#80, #82), the playtest privacy policy (#79, #81), and the product-strategist (scope) and
solution-architect (prerequisites) planning reviews of 2026-10-07.

Phase 1 exit is not met: the internal playtest has not run. This sprint stays in Phase 1.

## Goal

**Get the build ready for a measurable, safe Stage 0 team dogfood.** That means:

- the exit KPIs (session length, would play again, crash-free) are captured on the device and can leave it;
- Hermes and Node are proven to give identical engine results, in CI and on a real phone;
- the owner's device feedback is triaged and every S1/S2 item is fixed.

## Success indicators (measured at the Q6 exit check)

1. Every owner-feedback item has a severity, an owner and a status; 0 open S1/S2 items.
2. The Hermes golden job is green on `main`, runs a Hermes VM that matches the SDK 57 pin, and is proposed as a
   required check. The same runner passes on the owner's phone.
3. H1 timings are recorded from the owner's phone (labelled "owner device" unless it is low-end reference class).
4. S5 and S6a–S6c are merged behind default-off flags; a dry-run readout computes the three exit KPIs from a
   Stage 0 export.
5. `pnpm validate` and the framework tests use < 50 MB of temp space and leave nothing behind.
6. `main` green; production bundle gate green, with a test proving the diagnostics code is absent from it.

## Decisions taken in planning

- **No crash SDK (Sentry) in Phase 1.** It would reverse spec decisions Q-1/Q-7 and TM-10, add a third-party processor
  (privacy policy and consent change) and cost bundle headroom (88.2 % used). Crash-free is measured by
  `app_opened.previous_exit_unclean` (S6a) plus Play vitals once the Play org account exists. ADR-0009 still holds for
  Phase 2.
- **H1 without adb:** a preview-only Diagnostics screen (7 taps on the version label) runs the golden runner and the
  P5 §7 benches and shares a JSON report. It is removed from production builds at build time.
- **S6 is split** into four thin slices (S6a–S6d). The spec amendment comes first; no new `/feature-spec` is needed.
- **v2 re-attempt is out.** Phase 1 runs v1; B-01 (52.34 %) and C-05 (43.11 %) are recorded risks for casual play
  against bots.
- **~20 % capacity is reserved** for the owner-feedback fixes (F1).

## Tasks

Contracts and decisions come before implementations; tests before code.

| ID  | Task                                                                                            | Owner agent                                            | Depends on     | Acceptance criteria                                                                                                                                                                                                                                                                                | Size         | Status           |
| --- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------- |
| T0  | Fix `tools/framework/validate.test.mjs` temp copy                                               | devops-sre                                             | —              | Copies only the paths the validator reads, with a filter excluding `.claude/worktrees` and `node_modules`; `rmSync` in `finally`; a test asserts `worktrees` is absent from the copy; temp use < 50 MB; nothing left after a failing test                                                          | S            | todo             |
| F1  | Owner device feedback triage and fixes                                                          | product-strategist, qa-engineer, mobile-engineer       | owner feedback | Every item has severity S1–S4, owner, status; phone model, RAM and Android version recorded; S1/S2 (crash, lost move, score mismatch, resume failure) fixed with a regression test                                                                                                                 | M (reserved) | waiting on owner |
| SP2 | Spec amendment of `classic-match-vs-bot.md`                                                     | product-strategist                                     | —              | S6 split into S6a–S6d in the slice table; "Send match log" moved from S3 to S6d (Q5 finding S4); H1 owner-device vs reference note; AC-19 remote kill switch recorded as a Stage 1 gate                                                                                                            | S            | todo             |
| A1  | ADR for the Hermes golden runner                                                                | solution-architect                                     | —              | Next free ADR number (0015 is earmarked in bots-off-ui-thread §8; collision recorded); decides: build the `hermes` VM from source at the tag matching `hermes-compiler` 250829098.0.17, cached by tag; one pure-TS runner used in CI and on device; re-pin step added to the SDK-upgrade checklist | S            | todo             |
| A2  | Golden-runner output schema and Diagnostics report schema                                       | solution-architect, mobile-engineer                    | A1             | zod schemas; the report is comparable to the Node P5 §2 harness; device model/OS allowed only in preview builds                                                                                                                                                                                    | S            | todo             |
| A3  | Diagnostics screen design note + security check                                                 | solution-architect, mobile-engineer, security-engineer | A2             | ~1 page: preview-only build-time constant, dead-code elimination, export via TM-04 share/cleanup; security-engineer sign-off recorded                                                                                                                                                              | S            | todo             |
| D1  | S6 contracts: export envelope `exportFormat: 1` and analytics event schemas                     | mobile-engineer, data-analyst                          | SP2            | zod schemas frozen against `ANALYTICS_EVENTS.md` (closes the AC-17 schema check); OQ-3 answered by data-analyst                                                                                                                                                                                    | S            | in review        |
| P3  | CI Hermes golden job                                                                            | devops-sre, mobile-engineer                            | A1, A2         | Compares rng, sha256, JCS and replay vs Node; green on `main`; cache hit on re-run; proposed to the owner as a required check                                                                                                                                                                      | M            | todo             |
| R1  | Close the S3 review                                                                             | code-reviewer, security-engineer, privacy-compliance   | —              | `/review` and the privacy/security sign-off on TM-03 (Documents directory deviation) and the TM-04/05 split recorded                                                                                                                                                                               | S            | todo             |
| S6a | Consented queue, consent toggle, Settings, install id, `previous_exit_unclean`, `foreground_ms` | mobile-engineer, ux-ui-designer                        | D1, R1         | AC-17; persisted queue survives process kill; nothing recorded without consent; flag `analytics.upload.enabled` off; EN/FR; bundle delta in PR                                                                                                                                                     | M            | todo             |
| S6b | Playtest survey                                                                                 | mobile-engineer, ux-ui-designer                        | S6a            | AC-18; "would play again" captured; flag `playtest.survey.enabled` off                                                                                                                                                                                                                             | S            | todo             |
| S6c | "Send playtest data" share                                                                      | mobile-engineer, privacy-compliance                    | S6a, D1        | Export in `exportFormat: 1`; temp file cleaned up; privacy-compliance review recorded                                                                                                                                                                                                              | S            | todo             |
| S6d | "Send match log" + TM-04/05/07 sheet                                                            | mobile-engineer, security-engineer                     | S6c            | AC-20; TM-04/05/07 closed; security-engineer review                                                                                                                                                                                                                                                | S            | todo             |
| S5  | Post-match Knowledge Card + related terms                                                       | mobile-engineer, ux-ui-designer                        | —              | AC-13, AC-14; flag `knowledge_card.post_match.enabled` off; local data only; EN/FR; a11y; bundle delta in PR                                                                                                                                                                                       | M            | todo             |
| DG1 | Diagnostics screen                                                                              | mobile-engineer                                        | A2, A3, S6c    | Runs the golden runner, P5 §7 benches (constants, compute distribution, decision equality on 20 positions per bot, 10-match drift) and a resume p95 probe; shares a JSON report; production bundle test proves marker strings absent                                                               | M            | todo             |
| H1  | Device timings on the owner's phone                                                             | mobile-engineer, ai-engineer, product owner            | DG1            | Preview profile confirmed as a release Hermes build (not a dev client); `has()` p99, `apply` p95, bot think p95, resume p95 recorded with device class; golden runner equal to Node                                                                                                                | S            | todo             |
| KR  | Exit-KPI readout script                                                                         | data-analyst                                           | D1, S6a, S6b   | Computes median session, would-play-again and crash-free from exports; dry-run on a Stage 0 export                                                                                                                                                                                                 | S            | todo             |
| G1  | C-05 decision                                                                                   | game-designer                                          | —              | Written risk acceptance for casual play vs bots, or a restated target, in `docs/game/decisions/`                                                                                                                                                                                                   | S            | todo             |
| X2  | `sprintf-js` audit row                                                                          | security-engineer                                      | —              | Row in `docs/security/audit-exceptions.md` with reachability note and expiry, or a fix                                                                                                                                                                                                             | S            | todo             |
| S4  | Strategist opponent selector (stretch)                                                          | mobile-engineer                                        | H1             | Only if S5, S6a and S6b merge by mid-sprint; flag `bots.strategist.enabled` stays off until H1 passes the P5 §6 rule                                                                                                                                                                               | M            | stretch          |
| BS  | BC artifact sha256 check (slack)                                                                | ai-engineer                                            | —              | `results.json` sha256 compared to CI run 37288067161 artifact                                                                                                                                                                                                                                      | S            | stretch          |
| Q6  | Sprint 4 exit check                                                                             | qa-engineer                                            | all            | Gates, indicators and carry-over as in Q5                                                                                                                                                                                                                                                          | S            | todo             |

## Out of scope

- Crash SDK (see decisions). v2 re-attempt. Remote config fetch (AC-19), which becomes a Stage 1 gate.

## Risks

1. **H1 may fail** (Hermes factor worse than ×10, or resume p95 > 300 ms). S4 stays off; resume rework would follow.
2. **Hermes/Node divergence** would invalidate resume on device. That is why A1/P3 come first.
3. **Building Hermes from source in CI** is slow and must be re-pinned on every SDK bump.
4. **Bundle headroom** (88.2 %). Every PR states its size delta; diagnostics must not reach production.
5. **The owner's phone may not be low-end.** Then H1 is "owner device" only and reference phones stay an owner ask.
6. **Store and legal lead time** still sets the Stage 1 date.

## Human asks (product owner)

1. Device feedback: model, RAM, Android version, smoothness, bot think time, bugs, resume after close.
2. Confirm `com.codelex.app` as permanent before any Play upload.
3. Keep EAS on the personal account @m67, or move it to an organisation.
4. D-U-N-S number, Apple and Google org accounts.
5. Make "Golden immutability" (and later the Hermes job) a required check.
6. Counsel review of the three `LEGAL_REVIEW_REQUIRED` items in the privacy policy.
7. Legal entity, privacy contact and playtest mailbox (OQ-1).
8. Dakar community and school contacts; enrolment form tool.
9. Budget for 3–5 low-end reference phones, if the owner's phone is not low-end.
