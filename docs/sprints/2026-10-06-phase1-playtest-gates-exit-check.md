# Sprint 3 exit check (Q5, 2026-10-06) — Playtest gates

Sprint: `docs/sprints/2026-10-04-phase1-playtest-gates.md`. Previous exit check: Q2 in
`docs/sprints/2026-10-03-phase1-bots-app-foundation.md` (#53). Checked against `docs/standards/DEFINITION_OF_DONE.md`.

Measured by `qa-engineer` on `origin/main` at `74288b2` (#75), clean worktree. All commands ran from
`pnpm install --frozen-lockfile`, with `--force` so no result is a cache replay.

## Gates

| Gate               | Command                                                                     | Result                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validation         | `pnpm validate`                                                             | exit 0; 0 open NEEDS_REVIEW (7 irregular inflections confirmed as data); golden-immutability tests included                                        |
| Lint, types, tests | `pnpm turbo run lint typecheck test --concurrency=1 --force` (all packages) | green, 33 / 33 tasks, 0 cached, 6 min 28 s                                                                                                         |
| Bundle gate        | `pnpm turbo run bundle:check --filter=@codelex/mobile --force`              | green, 10 / 10 tasks. Android 3,818,556 / 4,330,000 B (88.2 %), iOS 3,635,680 / 4,120,000 B (88.2 %), lexicon 361,352 B                            |
| Dependency audit   | `pnpm audit --audit-level=high`                                             | exit 0: 2 high ignored (braces, node-forge), 2 moderate below the gate (decode-uri-component, sprintf-js; see risks)                               |
| CI on `main`       | GitHub checks on `74288b2`                                                  | Dependency audit, Golden immutability, Scaffold golden path, Lint/typecheck/test (affected), Framework & lexicon, CodeQL, Secret scan: all success |

Suite sizes: config 334 tests, observability 240, design-system 28, lexicon 207, game-engine 620, bots 169, mobile 237
(jest) + 19 (node:test budget script). Coverage floors were not re-measured here; the PR bodies report mobile at
96.3 % statements and 89.1 % branches (#75), above the 80 % floor.

Not run: the Maestro flows (`s1-…`, `s2-…`, `s3-process-kill-resume.yaml`) need a device build.

## Sprint rows

Status is done, partial or carried over. Every owner is the row's owner agent.

| ID  | Status            | Evidence (PR, file, test)                                                                                                                                                                                                        | Owner                                               |
| --- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| P1  | done              | #57: `docs/adr/0014-multiple-rules-versions-in-one-engine-build.md`; registry and draft rule landed with E6 (#63)                                                                                                                | solution-architect, game-engine-engineer            |
| P2  | done              | #57: API Q1–Q7 closed in `docs/architecture/notes/game-engine-api.md`; Q7 implemented by S3 (#75)                                                                                                                                | solution-architect                                  |
| P3  | **partial**       | Golden immutability: #58, CI check "Golden immutability" green on `main`. **Hermes golden job: not done** (hermes CLI version mismatch). No interim Hermes constants exist                                                       | devops-sre, mobile-engineer                         |
| P4  | done              | #70: format-1 freeze trigger in lexicon-index §3.3                                                                                                                                                                               | lexicon-engineer, solution-architect                |
| P5  | done, device open | #69: `docs/architecture/notes/bots-off-ui-thread.md`. Decision: JS thread plus UI-thread worklets, no ADR-0015. Equal decisions checked on 3,200 Node decisions; responsiveness and the Hermes ×10 factor are estimates until H1 | mobile-engineer, ai-engineer                        |
| P7  | done              | #59: size gate restated (limit 215 B/form f1, 128 f0); irregular plurals stored as data                                                                                                                                          | lexicon-engineer, mobile-engineer                   |
| P8  | done              | #70: `inflections: none` profile; `global-no-inflections.f1/f0.clxi` built in the gate run                                                                                                                                       | lexicon-engineer                                    |
| P9  | done              | #67: `docs/security/threat-models/e-1.5-s1-persistence-match-log.md`; TM-01..TM-11 owner tasks. TM-04/05 export parts remain open (S6)                                                                                           | security-engineer, privacy-compliance               |
| ST0 | done              | #61: `docs/specs/E-1.3-bots/strategist.md`                                                                                                                                                                                       | ai-engineer, game-designer                          |
| V1  | done              | #56: `docs/specs/E-1.6-balance/v2-balance-check.md`, written before any v2 run (blob `ee714c6a…` unchanged at BC)                                                                                                                | game-designer                                       |
| SP1 | done              | #60: E-1.5/E-1.7 spec fold-ins and analytics catalogue                                                                                                                                                                           | product-strategist, game-designer, data-analyst     |
| C3  | done              | #62: 2,154 forms, validator 0 errors / 0 NEEDS_REVIEW, size gate green (indicator 1)                                                                                                                                             | lexicon-curator                                     |
| E6  | done              | #63: rules registry, v2 draft behind the opt-in, snapshot replay, R-TURN-004 property                                                                                                                                            | game-engine-engineer                                |
| B3  | done              | #65: simulator v1/v2 by flag, BG-2a yardstick, C-10/C-11; used by BC                                                                                                                                                             | ai-engineer                                         |
| B4  | done              | #66: `docs/game/sim/2026-10-b4-strategist/readout.md`: ST-1 82.83 % [81.11, 84.43], 32,000 matches all accepted by `apply`, ST-5 0.33–0.36 %                                                                                     | ai-engineer                                         |
| L7  | done              | #64: letters-v2 derived from batch 3 and `gameValue` decoupling (T-4a, T-6)                                                                                                                                                      | game-designer, lexicon-engineer                     |
| BC  | done, v1 fallback | #68 workflow, #71 outcome: `docs/game/sim/2026-10-v2-balance-check/digest.md`. Both v2 variants fail the pre-registered list; decided by D0+9. sha256 check against the CI artifact open                                         | game-designer, ai-engineer                          |
| R4  | not triggered     | v1 fallback: no GAME_RULES 0.4 PR, no T-8, `replays/v2` not frozen                                                                                                                                                               | game-designer, game-engine-engineer, ux-ui-designer |
| S1  | done              | #73: `match-screen.test.tsx`, two seeds played through the UI, 0 score mismatches; bundle budget raised with owner approval recorded in the PR; Skia ≈ 454 KB of bytecode per platform                                           | mobile-engineer, ux-ui-designer                     |
| S2  | done              | #74: `match-s2.test.tsx`, natural end and Resign, 0 mismatches; AC-3/AC-5 as folded in by SP1; EN/FR                                                                                                                             | mobile-engineer, ux-ui-designer                     |
| S3  | **partial**       | #75: `src/persistence/saved-match.test.ts` kills at every write boundary, 0 moves lost. **"Send match log" per P9 moved to S6** (TM-04/05 sheet); resume p95 not measured                                                        | mobile-engineer                                     |
| S4  | **carried over**  | Stretch, not started                                                                                                                                                                                                             | mobile-engineer                                     |
| H1  | **blocked**       | No low-end Android device and no EAS organisation (owner asks). No Hermes-CLI interim report either, because P3 is deferred                                                                                                      | mobile-engineer, devops-sre                         |
| X1  | done              | #72: node-forge and braces renewed to 2026-11-04, uuid fixed by override; #76 `source-map-js` override                                                                                                                           | security-engineer, mobile-engineer                  |
| Q5  | done              | This document                                                                                                                                                                                                                    | qa-engineer                                         |

Totals: 20 done (BC with the v1 outcome), 2 partial (P3, S3), 1 not triggered (R4), 1 carried over (S4), 1 blocked (H1).

## Success indicators

| #   | Indicator                                                                   | Result                                                                                                                                                                                                                                                                                                   | Status                                  |
| --- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1   | Batch 3 meets E-1.7 AC-14                                                   | 2,154 playable forms (≥ 2,000), 1,432 canonical (≥ 1,300), validator 0 errors and 0 open NEEDS_REVIEW, 2–4-letter share 24.3 % (20–25 %), 48 two-letter forms (≥ 30), f1 361,352 B = 167.8 B/form (limit 215), f0 64.2 B/form (limit 128). Gate run re-built the artefacts and the size tests pass       | met                                     |
| 2   | Strategist meets B-07 and its budgets                                       | B-07 82.83 % [81.11, 84.43] (≥ 60 % lower CI) on the confirmation seeds; deterministic, 100-match re-runs identical; 32,000 matches, 100 % accepted by `apply`; BG-5 0.00 % (Beginner), `budgetExhausted` 0.33–0.36 % (≤ 1 %); node p95 11,622–12,181 (≤ 35,000)                                         | met                                     |
| 3   | Batch-3 readout (AC-20), chosen rules (v1)                                  | C-02 6.39 % (≤ 15), C-10 1.48 % (≤ 5), C-11 92.6 (≥ 90), top-20 25.80 % (≤ 40): met. BG-1/2a/3/4 met. B-01 v1 52.34 % [51.36, 53.33]: risk recorded as the indicator allows. **C-05 v1 43.11 % [43.04, 43.18] vs ≤ 35 %: not met**, and v2 did not fix it within B-01 (see risks)                        | partly met; B-01 recorded, C-05 not met |
| 4   | v1/v2 decision by D0+9                                                      | Recorded 2026-10-05: v1 fallback. v2-3612 fails P-2, v2-248 fails P-1 (upper CI 52.12 %), 0 verdict mismatches in the independent re-check                                                                                                                                                               | met                                     |
| 5   | S1–S3 dev build                                                             | Scripted full match completes in every test run (2 seeds in S1, S2 natural and Resign); 0 engine/app score mismatches; 0 committed moves lost in the kill-at-every-write-boundary test; EN/FR; bundle gate green. All of it runs in Jest, not as a real process kill on a device (Maestro flows not run) | met in simulation; device not run       |
| 6   | Main green; validate; golden-immutability and Hermes goldens required in CI | Main green and `pnpm validate` passes. "Golden immutability" runs and passes in CI, but whether it is a **required** branch-protection check cannot be read with this token (owner ask). Hermes golden job does not exist                                                                                | partly met; Hermes goldens not met      |
| 7   | H1 measured, or "not measured" with an interim Hermes-CLI `c_node`          | **Not measured.** No device. No Hermes-CLI estimate either (P3 deferred); the only estimate is Node `c_node` × 10 in the P5 note                                                                                                                                                                         | not met (reported as not measured)      |

## Definition of Done spot checks

| Item                                | Result                                                                                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flags default off, kill switch      | `play_vs_bot.enabled` defaults to off; `board.tech_squares.enabled` off and inert; `bots.strategist.enabled` in the Strategist spec                       |
| EN/FR strings, a11y, reduced motion | covered by S1–S3 tests (FR copy, 15×15 accessible grid, live reduced motion, one restore announcement)                                                    |
| Analytics events                    | `bot_*`, `app_backgrounded`, resume events wait for the S6 consented buffer (AC-17). No event fires today; schema verification is therefore carried to S6 |
| `/review` on S3                     | the S3 PR body leaves `/review` and the privacy/security review unchecked; no evidence of closure in the repo                                             |
| Golden replays                      | `replays/v1` unchanged; GC-DET-01 digest unchanged by S1–S3                                                                                               |
| Determinism across runtimes         | Node only. Hermes equality is unverified in CI                                                                                                            |

## Defects and findings

No S1 or S2 defects found by the gates. Findings, in severity order:

| Sev | Finding                                                                                                                                                                            | Owner                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| S2  | The build trusts Hermes and Node to give bit-identical engine and bot results, with no CI proof. A divergence would break resume (hash mismatch) and the replay contract on device | devops-sre, mobile-engineer        |
| S2  | The v1 term-bonus share (C-05) is 43.11 % against a ≤ 35 % target, and the BC outcome note records only B-01 as the accepted risk. Accept it explicitly or restate the target      | game-designer                      |
| S3  | New moderate advisory `sprintf-js` (GHSA-hp3w-g68c-fv3c) appears in `pnpm audit` and has no row in `docs/security/audit-exceptions.md` (below the CI gate)                         | security-engineer, mobile-engineer |
| S3  | S3 PR leaves `/review` and the privacy/security review unchecked (TM-03 Documents-directory deviation, TM-04/05 split)                                                             | security-engineer, code-reviewer   |
| S4  | Docs: the S3 row's "Send match log per P9" criterion was moved to S6 in the PR but not in the spec table before this check                                                         | product-strategist                 |

## Carry-over to sprint 4

| Item                                                                                    | Owner                              | Note                                                                                                                              |
| --------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| P3 Hermes golden job (rng, sha256, JCS, replay vs Node, required check)                 | devops-sre, mobile-engineer        | Hermes CLI version does not match the SDK 57 pin. Also yields interim Hermes constants for H1                                     |
| H1 device timings: `has()` ≤ 20 µs p99, `apply` < 10 ms, bot moves, resume p95 ≤ 300 ms | mobile-engineer, devops-sre        | Blocked on a low-end Android device and the EAS organisation. Includes the P5 §7 measurements and the TM-03 backup check          |
| S4 Strategist opponent selector                                                         | mobile-engineer                    | Not started. Needs the ST-8 sign-off already recorded (+1.02 points accepted)                                                     |
| S3 "Send match log", TM-04/TM-05 sheet, TM-07                                           | mobile-engineer, security-engineer | Now in S6; TM-06, TM-08..TM-11 keep their owners and gates from the threat model                                                  |
| v2 re-attempt                                                                           | game-designer                      | New pre-registration file version and a new master seed; B-01 and C-05 are the open criteria                                      |
| BC artifact sha256 (results.json `a41425ec…`) against CI run 37288067161                | ai-engineer                        | Committed file is a local deterministic reproduction; this sandbox cannot download the artifact                                   |
| `sprintf-js` advisory row                                                               | security-engineer                  | Add the row with a reachability note, or fix                                                                                      |
| Audit exceptions node-forge and braces                                                  | security-engineer                  | Renewed to 2026-11-04 (the sprint file said 2026-11-02)                                                                           |
| Owner asks still open                                                                   | product owner                      | Make "Golden immutability" a required check; bundle ID and EAS organisation; D-U-N-S; device; tester contacts; privacy-policy URL |

## Risks carried into sprint 4

1. **Hermes/Node determinism is unverified in CI** (S2). S1–S3 ship on trust. Mitigation: P3 first, then H1's full-match hash check on a release Hermes build.
2. **The 300 ms resume target is unmeasured on a device.** Resume replays every action twice (verify, then fold), so the snapshot speeds up only the check. If H1 misses, the log fold needs a rework.
3. **Power loss without fsync.** expo-file-system has no fsync, so after a power loss (not a process kill) at most the torn last record is lost. Process-kill safety is tested; power-loss safety is not.
4. **The placeholder bundle ID** (`com.codelex.app`, assumed). It is permanent on Google Play once uploaded, and the EAS organisation depends on it.
5. **v2 re-attempt** (game-designer, sprint 4, new pre-registration). Until then the playtest runs v1 with B-01 at 52.34 % and C-05 at 43.11 %, accepted for casual play against bots only (no ranked, no leaderboard).
6. **Bundle headroom:** 88.2 % of the raised budget after Skia. Another feature slice may need a tree-shaking result or a new approval.
7. **Store and legal lead time** (D-U-N-S, counsel, privacy-policy URL) still sets the playtest date T.

## Verdict

**Go for closing sprint 3. No-go for distributing a playtest build.**

- Every repo-side gate that could close has closed: batch 3, Strategist, the v1 decision, and S1–S3 behind a default-off flag, with `main` green and `pnpm validate` passing.
- No-go for Stage 1 distribution until three things hold: the Hermes golden job (P3) is green and required, H1 is measured on a real device, and the owner asks above are answered. The release criteria in the QA charter (crash-free sessions, E2E on a device, rollback tested) cannot be evaluated yet because no build has run on a device.
