# Sprint 2026-10-03 — Phase 1 · Bots and app foundation

**Goal:** a deterministic Beginner bot plays full Classic matches against the real lexicon index, a simulator
reports how thin the lexicon still is, and the mobile app, design system and i18n packages exist with CI, so that
next sprint builds the E-1.5 screens on solid ground. The previous sprint's reviews are closed.

**Status:** Planned 2026-10-03 by the orchestrator under the product owner's delegation ("take the best decisions
for me"; "Vas y"), then revised the same day with the P0 reviews of `product-strategist` and `solution-architect`
(see the decisions log). Every decision is reversible unless an ADR says otherwise.

## Scope

- **In:** retroactive reviews of sprint 1 (R1–R4); open rules questions Q-GD-1..5 (G1) and the engine change they
  imply (E5); GADDAG section of the `.clxi` index (E-1.2 T6) and index tooling (T8/T9); `packages/bots` with
  random-legal and Beginner (E-1.3) and a simulator CLI; lexicon batch 2 (E-1.7, ≥ 1,400 forms); E-1.4 design
  system v1 spec and scaffolds of `apps/mobile`, `packages/design-system`, `packages/i18n`; engine and index on
  Hermes.
- **Stretch:** E-1.5 slice S1 (home, PLAY NOW, full match vs Beginner, minimal end screen, behind
  `play_vs_bot.enabled`), including the first Skia board renderer, for early dogfood data (crash-free, match
  completion) on real devices.
- **Out (next sprints):** Strategist bot (required for the playtest, planned next sprint), remaining E-1.5 slices
  and the playtest build, E-1.6 balance calibration (meaningless below 2,000 forms, batch 3), lexicon batch 3.

## Decisions taken for this sprint

- **Reviews before new engine code:** R1 (`code-reviewer` on #24–#28) runs first; any blocking finding is fixed
  before B1 builds on the engine API.
- **GADDAG stays in `.clxi` format 1** (solution-architect): no artefact has left CI and no replay is published,
  so format 1 is not frozen yet. The current decoder rejects any non-zero `flags` as `CORRUPT` and requires exactly
  13 sections, so L5 changes the layout: a fixed 15-section table (`GADDAG_NODES`, `GADDAG_EDGES`, empty when bit
  0 is clear), bit 0 accepted, other bits → `UNSUPPORTED_FORMAT`; `format.ts`, lexicon-index note §3.3 and the
  golden pins updated. **Format 1 freezes** when the first artefact ships (A1/T10) or the first replay is
  published; any later layout change is format 2. The manifest and storage key carry the flags (a mobile build
  without GADDAG has the same version/profile/hash but different bytes). Size gate: GADDAG ≤ 6× DAWG at current
  size; mobile can omit it if the gate fails at 50,000 forms.
- **Bots consume `Observation` + `evaluateMove` only** (API note API-6, §19); move generation uses the GADDAG and
  `crossCheck`; randomness from `bot:<seat>:<n>` streams; compute bounded by a node budget, never wall clock.
- **Bots contract before code** (solution-architect): `docs/architecture/notes/bots-api.md` (no ADR, reversible)
  fixes `chooseAction(obs, ctx): Result<BotDecision, BotError>` with `BotContext { lexicon, rng, personality,
budget { maxNodes, maxCandidates } }`, a node = one GADDAG/DAWG arc step, best-so-far on budget exhaustion,
  ADR-0013 tie-breaks, rule-correct fallback (exchange, else pass), integer-only personalities, DAWG fallback
  when `gaddag` is undefined (property: same move set), property "the chosen action is always accepted by
  `apply`". `ai-engineer` answers API note §20 Q8–Q12 at the same time; `solution-architect` closes Q1–Q7 before B2
  writes the first replay logs (Q1/Q2 become one-way once logs exist).
- **Rules questions decided (G1, GAME_RULES v0.3.1):** every default reading kept; Q-GD-3 = resigned teams share
  their place, no hashed resignation order, so `engineRulesVersion` 1 and GC-DET-01 are unchanged; E5 is test and
  comment cleanup only.
- **First-player win rate is measured now** (product-strategist): B2 runs Beginner-vs-Beginner mirror matches with
  a confidence interval (a Phase 1 exit criterion), plus the E-1.7 AC-20 with/without-inflections comparison.
- **App stack per ADR-0002** (React Native + Expo, Reanimated, react-native-skia), no new ADR. A short app design
  note comes with A1: Expo SDK and New Architecture pin, `.clxi` loading per lexicon-index note §3.5 (Metro
  `assetExts`, sha256 check, corrupt-index state, copy step from the lexicon build), i18n contract (ICU
  MessageFormat JSON catalogs, key naming, FR plurals, Hermes `Intl` polyfill). Crash reporting follows the E-1.5
  decision for the playtest build: unclean-exit flag plus TestFlight / Play Console statistics, no crash SDK.
- **E-1.4 spec stays thin** (D5): tokens, board renderer contract, reduced-motion rules; no full design system
  ahead of S1.

## Success indicators

- R1–R4 closed: every blocking finding fixed or explicitly accepted by the product owner.
- GADDAG: language equals the DAWG (T-GADDAG), every (form, split) path present, `crossCheck` via GADDAG ≡ brute
  force; artefact still byte-identical across builds.
- Bots: ≥ 1,000 seeded matches (Beginner vs random-legal and Beginner mirror), deterministic under seed (same log,
  same hash), every chosen action accepted by `apply`; first-player win rate reported with a 95 % CI; no-legal-word
  turn rate ≤ 25 % at batch 2 (trend toward E-1.7's ≤ 15 % at batch 3); scoreless-ending rate, top-20 term share and
  games/s reported; DAWG-only generation timed against the 2 s device budget (Q-A2).
- Lexicon ≥ 1,400 playable forms, verb kinds only on the closed list (C-LC-3), validator green, 2–4-letter share
  ≤ 26 %.
- `apps/mobile`, `packages/design-system`, `packages/i18n` build, lint and test in CI; engine and index timings on
  Hermes **and on at least one real low-end Android device** (`has()`, `apply`, one bot move).

## Tasks

| ID  | Task                                                                                                            | Owner agent                                                           | Depends on             | Acceptance criteria                                                                                                                                                                 | Size | Status     |
| --- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ---------- |
| P0  | Review this plan: scope, KPIs, contracts                                                                        | product-strategist, solution-architect                                | —                      | Comments folded into this file; any changed task re-scoped before it starts                                                                                                         | S    | done       |
| R1  | Retroactive code review of #24–#28 (L3, E2, E3, E4, L4)                                                         | code-reviewer                                                         | —                      | Findings filed per PR; blocking ones fixed in follow-up PRs with tests; verdict recorded in the decisions log                                                                       | M    | todo       |
| R2  | Curator second pass on lexicon batch 1b (#29)                                                                   | lexicon-curator                                                       | —                      | ≥ 10 % spot-review per D-11 plus all 70 new terms read; fixes in one PR; 6 irregular plurals confirmed or removed                                                                   | S    | todo       |
| R3  | Independent QA of the sprint 1 exit check                                                                       | qa-engineer                                                           | —                      | Each Q1 indicator re-measured or challenged; gaps filed as tasks                                                                                                                    | S    | todo       |
| R4  | Security review of the audit exception (#30)                                                                    | security-engineer                                                     | —                      | Exception accepted, shortened or replaced (e.g. by removing the plugin); register updated                                                                                           | S    | done (#34) |
| G1  | Decide rules questions Q-GD-1..5 (API note §16)                                                                 | game-designer                                                         | —                      | Each question answered in GAME_RULES / API note; `@ambiguous` tests updated to the decided reading                                                                                  | S    | done (#33) |
| E5  | Engine follow-up from G1 and R1: drop `@ambiguous`, 4 decision tests, R1 fixes                                  | game-engine-engineer                                                  | G1, R1                 | Decided readings pinned by tests (FFA limit after resign, places 1-2-3-3, 4-way tie, retired racks in `finalRacks`); R1 blocking findings fixed                                     | S    | todo       |
| L5  | GADDAG section in `.clxi` format 1 (lexicon-index note T6)                                                      | lexicon-engineer                                                      | R1                     | 15-section table, bit 0 accepted, other bits `UNSUPPORTED_FORMAT`; decoder exposes `gaddag`; T-GADDAG; `crossCheck` via GADDAG ≡ brute force; size gate; manifest key carries flags | M    | todo       |
| L6  | Index tooling (T9 now, T8 stretch): Turborepo `build:index` task; benchmark JSON in CI                          | lexicon-engineer, devops-sre                                          | L5                     | `pnpm turbo run build:index` cached on inputs (needed by A1); benchmark artefacts are stretch                                                                                       | S    | todo       |
| B0  | Bots design note `docs/architecture/notes/bots-api.md`; Beginner strength and budget mapping                    | ai-engineer, solution-architect, game-designer                        | —                      | Contract above; Beginner defined on the B-07 ladder (human win ≥ 55 %); node budget ↔ E-1.5 AC-9 latency (p95 ≤ 2 s); API note Q8–Q12 answered                                      | S    | todo       |
| B1  | `/scaffold packages/bots`; random-legal and Beginner bots                                                       | ai-engineer                                                           | B0, R1, L5             | `chooseAction(observation, ctx)` with node budget; deterministic under `bot:<seat>:<n>`; GADDAG move generation; scoring only via `evaluateMove`                                    | M    | todo       |
| B2  | Simulator CLI: lexicon-thinness and first-player report                                                         | ai-engineer                                                           | B1                     | ≥ 1,000 seeded matches incl. Beginner mirror; first-player win rate with 95 % CI; AC-20 with/without inflections; replays verified; API note Q1–Q7 closed first                     | M    | todo       |
| C2  | Lexicon content batch 2 (E-1.7 D-16)                                                                            | lexicon-curator                                                       | R2                     | ≥ 1,400 forms; verb forms on the closed list only; longer canonical terms first; category and difficulty bands held                                                                 | L    | todo       |
| D5  | Thin E-1.4 spec: tokens, board renderer contract (Skia), reduced-motion rules                                   | ux-ui-designer, mobile-engineer                                       | —                      | Enough for S1 and A1; full design system later                                                                                                                                      | S    | todo       |
| A1  | `/scaffold apps/mobile` (Expo), `packages/design-system`, `packages/i18n` + app design note                     | mobile-engineer, frontend-web-engineer                                | L6 (`.clxi` copy step) | Build, lint, typecheck, test in CI; EN/FR ICU catalogs; bundle-size budget; engine imported; `.clxi` asset loaded and verified                                                      | M    | todo       |
| H1  | Engine, index and bot timings on Hermes and a real low-end Android                                              | mobile-engineer, devops-sre                                           | A1, B1                 | `has()` ≤ 20 µs p99, `apply` < 10 ms, one Beginner move within budget, on Hermes and ≥ 1 real low-end Android device                                                                | S    | todo       |
| S1  | Stretch: E-1.5 slice S1 behind `play_vs_bot.enabled` (incl. first Skia board)                                   | mobile-engineer, ux-ui-designer                                       | A1, B1, D5             | Home, PLAY NOW, full match vs Beginner, minimal end screen; internal dogfood build                                                                                                  | L    | todo       |
| T2  | Playtest lead time (no code): enrollment plan, consent text, TestFlight / Play internal track, readout template | product-strategist, privacy-compliance, mobile-engineer, data-analyst | —                      | ≥ 30 adults with ≥ 30 % low-end Android and EN/FR mix; tracks configured; readout template (session = foreground time, `score_margin`)                                              | S    | todo       |
| Q2  | Sprint exit check                                                                                               | qa-engineer                                                           | B2, C2, A1, H1         | Success indicators measured and recorded here; main green; `pnpm validate` passes                                                                                                   | S    | todo       |

**Start now (2026-10-03):** R1–R3 are running; next in parallel: B0 (bots note), D5 (thin E-1.4 spec), A1
(scaffolds, without waiting for D5), T2 (playtest lead time); then L5 once R1 reports, C2 once R2 lands.

## Risks

- Review findings (R1) may reopen engine or index code that B1 depends on: R1 first, B1 after.
- Lexicon content remains the schedule risk toward 2,000 forms (batch 3 next sprint): C2 starts as soon as R2 ends.
- Hermes timings may miss the ≤ 20 µs device budget: fallback is a `Map`-backed `has` on device (lexicon-index note
  §5) without changing the interface.
- GADDAG size at scale: mobile may ship without it (bots fall back to DAWG generation, ≈ 2× slower); Q-A2 (is
  DAWG-only fast enough for Strategist within 2 s?) is a B1 benchmark exit criterion.
- ADR-0011 is absent from `docs/adr`: confirm whether the number was skipped on purpose (solution-architect).

## Decisions log

- 2026-10-03 — Sprint planned; sprint 1 carry-overs mapped to R1–R4, G1, L5, L6, B1, B2, C2, H1.
- 2026-10-03 — Sub-agents available again the same day (product owner: "vas y immédiatement"). P0 reviews folded
  in: A1 no longer waits for D5/P0, B1 no longer waits for E5, bots design note B0 added, B2 measures the
  first-player win rate, S1 (first playable slice) added as stretch, T2 (playtest lead time) added, indicators made
  numeric, crash reporting aligned with E-1.5 (no SDK), GADDAG layout change inside format 1 with an explicit
  freeze point. G1 decided (#33, GAME_RULES v0.3.1, no hashed-state change). R4 accepted the audit exception
  (#34).
