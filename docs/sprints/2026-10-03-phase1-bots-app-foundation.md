# Sprint 2026-10-03 — Phase 1 · Bots and app foundation

**Goal:** a deterministic Beginner bot plays full Classic matches against the real lexicon index, a simulator
reports how thin the lexicon still is, and the mobile app, design system and i18n packages exist with CI, so that
next sprint builds the E-1.5 screens on solid ground. The previous sprint's reviews are closed.

**Status:** Planned 2026-10-03 by the orchestrator under the product owner's delegation ("take the best decisions
for me"; "Vas y"). `product-strategist` and `solution-architect` are unavailable until 2026-10-05 (weekly limit):
their scope/contract review of this plan is task P0, first thing on their return. Every decision is reversible
unless an ADR says otherwise.

## Scope

- **In:** retroactive reviews of sprint 1 (R1–R4); open rules questions Q-GD-1..5 (G1) and the engine change they
  imply (E5); GADDAG section of the `.clxi` index (E-1.2 T6) and index tooling (T8/T9); `packages/bots` with
  random-legal and Beginner (E-1.3) and a simulator CLI; lexicon batch 2 (E-1.7, ≥ 1,400 forms); E-1.4 design
  system v1 spec and scaffolds of `apps/mobile`, `packages/design-system`, `packages/i18n`; engine and index on
  Hermes.
- **Stretch:** Strategist bot (needs leave evaluation); first Skia board renderer prototype.
- **Out (next sprints):** E-1.5 screens and playtest build, E-1.6 balance calibration (meaningless below 2,000
  forms, batch 3), lexicon batch 3.

## Decisions taken for this sprint

- **Reviews before new engine code:** R1 (`code-reviewer` on #24–#28) runs first; any blocking finding is fixed
  before B1 builds on the engine API.
- **GADDAG in the same `.clxi` format 1** behind the existing `flags` bit 0 (lexicon-index note §3.3): format 1
  decoders already reject unknown flags, so adding the section is a new flag value, not a new format. Size gate:
  GADDAG ≤ 6× DAWG at current size; mobile can omit it (`gaddag: false`) if the gate fails at 50,000 forms.
- **Bots consume `Observation` + `evaluateMove` only** (API note API-6, §19); move generation uses the GADDAG and
  `crossCheck`; randomness from `bot:<seat>:<n>` streams; compute bounded by a node budget, never wall clock.
- **Q-GD-3 before the first published replay:** if `game-designer` keeps "later resignation ranks higher", the
  engine adds a hashed field (e.g. `SeatState.resignedAt`) while no replay is published (`engineRulesVersion` 1 is
  not yet frozen by a published log); otherwise the "shared place" reading becomes the rule.
- **App stack per ADR-0002** (React Native + Expo, Reanimated, react-native-skia); scaffolds only this sprint,
  through `/scaffold`, with bundle-size and crash-reporting placeholders wired in CI.

## Success indicators

- R1–R4 closed: every blocking finding fixed or explicitly accepted by the product owner.
- GADDAG: language equals the DAWG (T-GADDAG), every (form, split) path present, `crossCheck` via GADDAG ≡ brute
  force; artefact still byte-identical across builds.
- Bots: Beginner vs random-legal ≥ 1,000 seeded matches, deterministic under seed (same log, same hash), 0 illegal
  moves; simulator prints no-legal-word turn rate, scoreless-ending rate, top-20 term share, games/s.
- Lexicon ≥ 1,400 playable forms, verb kinds only on the closed list (C-LC-3), validator green, 2–4-letter share
  moving toward 20–25 %.
- `apps/mobile`, `packages/design-system`, `packages/i18n` build, lint and test in CI; engine and index tests run
  on Hermes (or a Hermes CLI proxy) with timings recorded.

## Tasks

| ID  | Task                                                                                | Owner agent                            | Depends on     | Acceptance criteria                                                                                                                              | Size | Status |
| --- | ----------------------------------------------------------------------------------- | -------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------ |
| P0  | Review this plan: scope, KPIs, contracts                                            | product-strategist, solution-architect | —              | Comments folded into this file; any changed task re-scoped before it starts                                                                      | S    | todo   |
| R1  | Retroactive code review of #24–#28 (L3, E2, E3, E4, L4)                             | code-reviewer                          | —              | Findings filed per PR; blocking ones fixed in follow-up PRs with tests; verdict recorded in the decisions log                                    | M    | todo   |
| R2  | Curator second pass on lexicon batch 1b (#29)                                       | lexicon-curator                        | —              | ≥ 10 % spot-review per D-11 plus all 70 new terms read; fixes in one PR; 6 irregular plurals confirmed or removed                                | S    | todo   |
| R3  | Independent QA of the sprint 1 exit check                                           | qa-engineer                            | —              | Each Q1 indicator re-measured or challenged; gaps filed as tasks                                                                                 | S    | todo   |
| R4  | Security review of the audit exception (#30)                                        | security-engineer                      | —              | Exception accepted, shortened or replaced (e.g. by removing the plugin); register updated                                                        | S    | todo   |
| G1  | Decide rules questions Q-GD-1..5 (API note §16)                                     | game-designer                          | —              | Each question answered in GAME_RULES / API note; `@ambiguous` tests updated to the decided reading                                               | S    | todo   |
| E5  | Engine follow-up from G1 and R1 (e.g. hashed resignation order)                     | game-engine-engineer                   | G1, R1         | Decided readings implemented test-first; GC-DET-01 regenerated only if the hashed state changed, with the change logged                          | S    | todo   |
| L5  | GADDAG section in `.clxi` format 1 (lexicon-index note T6)                          | lexicon-engineer                       | R1             | `flags` bit 0; decoder exposes `gaddag`; T-GADDAG property; `crossCheck` via GADDAG ≡ brute force; size gate                                     | M    | todo   |
| L6  | Index tooling (T8/T9): Turborepo `build:index` task, benchmark JSON artefacts in CI | lexicon-engineer, devops-sre           | L5             | `pnpm turbo run build:index` cached on inputs; `has`/`crossCheck`/decode timings exported per CI run                                             | S    | todo   |
| B1  | `/scaffold packages/bots`; random-legal and Beginner bots                           | ai-engineer                            | L5, E5         | `chooseAction(observation, ctx)` with node budget; deterministic under `bot:<seat>:<n>`; GADDAG move generation; scoring only via `evaluateMove` | M    | todo   |
| B2  | Simulator CLI and lexicon-thinness report                                           | ai-engineer                            | B1             | ≥ 1,000 seeded Beginner-vs-random matches; reports the stretch metrics of sprint 1; replays verified                                             | M    | todo   |
| C2  | Lexicon content batch 2 (E-1.7 D-16)                                                | lexicon-curator                        | R2             | ≥ 1,400 forms; verb forms on the closed list only; longer canonical terms first; category and difficulty bands held                              | L    | todo   |
| D5  | `/feature-spec` + `/design` E-1.4 design system v1 and board renderer               | ux-ui-designer, mobile-engineer        | P0             | Tokens, core components, board renderer contract (Skia), motion and reduced-motion rules, a11y; ready for implementation                         | M    | todo   |
| A1  | `/scaffold apps/mobile` (Expo), `packages/design-system`, `packages/i18n`           | mobile-engineer, frontend-web-engineer | D5             | Build, lint, typecheck, test in CI; EN/FR message catalogs; bundle-size budget check; engine and lexicon imported                                | M    | todo   |
| H1  | Engine and index on Hermes                                                          | mobile-engineer, devops-sre            | A1             | Engine and `.clxi` test subsets run under Hermes (or Hermes CLI); `has()` and `apply` timings recorded against the ≤ 20 µs / < 10 ms budgets     | S    | todo   |
| Q2  | Sprint exit check                                                                   | qa-engineer                            | B2, C2, A1, H1 | Success indicators measured and recorded here; main green; `pnpm validate` passes                                                                | S    | todo   |

**Start first:** R1 (it gates engine-facing work), G1 and R2 in parallel on 2026-10-05; P0 the same day. Before the
agents return, the orchestrator can prepare L5 (GADDAG build) test-first, since its design is already fixed by the
lexicon-index note.

## Risks

- Review findings (R1) may reopen engine or index code that B1 depends on: R1 first, B1 after.
- Lexicon content remains the schedule risk toward 2,000 forms (batch 3 next sprint): C2 starts as soon as R2 ends.
- Hermes timings may miss the ≤ 20 µs device budget: fallback is a `Map`-backed `has` on device (lexicon-index note
  §5) without changing the interface.
- GADDAG size at scale: mobile may ship without it (bots fall back to DAWG generation, ≈ 2× slower).

## Decisions log

- 2026-10-03 — Sprint planned; sprint 1 carry-overs mapped to R1–R4, G1, L5, L6, B1, B2, C2, H1.
