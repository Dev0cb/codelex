# Sprint 2026-10-02 — Phase 1 · Engine core

**Goal:** the pure engine plays full, deterministic Classic matches end-to-end in tests against a real
`LexiconIndex`, and a first Beginner self-play run measures how thin the lexicon still is.

**Status:** Planned 2026-10-02 by the orchestrator under delegation from the product owner ("take the best
decisions for me"), with `product-strategist` (scope, KPIs) and `solution-architect` (design prerequisites). Every
decision below is reversible unless an ADR says otherwise.

## Scope

- **In:** E-1.1 core (board, bag, placement, validation, Classic scoring, end rules, serialisation, state hash,
  per-seat observation); E-1.2 tasks T0–T5 from `docs/architecture/notes/lexicon-index.md` (T6 GADDAG if capacity
  allows); E-1.7 inflection policy, schema v2 and a first content batch; Classic premium layout (A-02).
- **Stretch:** E-1.3 random-legal and Beginner bots plus a minimal simulator CLI (lexicon-thinness report).
- **Out (next sprints):** E-1.4 / E-1.5 app code, Strategist bot, E-1.6 calibration (meaningless below 2,000 forms),
  tech squares (off for the playtest), Hermes runtime in the CI matrix (from T5 onwards, next sprint).
- **Parallel, no code:** `ux-ui-designer` writes the E-1.5 design spec so mobile starts at full speed next sprint.

## Decisions taken for this sprint

- **ADR-0013 "Determinism and replay contract"** is required before engine code (one-way door once replays
  exist). Recommended content: xoshiro128** with 32-bit integer maths only; 64-bit seed as 16 hex chars; per-stream
  state from murmur3-fmix32 over `seedHex + ":" + streamName` (`bag`, `first-player`, `bot:<seat>`); rejection
  sampling; golden vectors. Action log `{logVersion, header:{seed, engineRulesVersion, lexiconVersion, profileId,
  definitionHash}, actions[]}` with integers and strings only; state hash = first 16 hex of SHA-256 (pure TS) over
  RFC 8785 canonical JSON; integer `engineRulesVersion` bumped whenever replay outcomes change; Phase 1 letter values
  and bag frozen by `engineRulesVersion`.
- **LexiconIndex:** build-time, content-addressed artefact bundled on mobile; no ADR (behind an interface,
  rebuildable). Canonical `lexiconVersion` (RFC 8785) settled now, recorded in `docs/game/LEXICON_SPEC.md`.
- **Inflections (plurals):** explicit, curated `inflections: [{form, kind}]` on the canonical term (schema v2), not
  rule-generated (rules produce junk on acronyms such as HTTPS); a helper script may suggest candidates. Index splits
  `FormRef` (playable form) from `TermRef` (metadata); term bonus and XP resolve to the canonical term.
- **Contracts live in their owner packages:** `@codelex/lexicon/index` (types, decoder, reference implementation;
  the engine imports types only and receives the index injected); `@codelex/game-engine` (`createMatch`, `apply →
  Result`, `observe`, `evaluateMove`, `stateHash`, `replay`; RNG at `@codelex/game-engine/rng`; no `legalMoves` —
  move generation belongs to bots); `@codelex/bots` (`chooseAction(observation, ctx)` with a node budget, never wall
  clock). No shared "types" package; Phase 2 `packages/protocol` will wrap engine types.
- **Specs:** engine and index work use `GAME_RULES.md` v0.2, `RULE_PROPERTIES.md` and the lexicon-index note as
  specs, plus a short engine API note. E-1.7 gets its own `/feature-spec` (it changes the schema and the index).

## Success indicators

- Every non-power Phase-1 rule ID has ≥ 1 passing test; all golden cases pass; `packages/game-engine` coverage ≥ 90 %.
- `P-GLOBAL-01..08` green under fast-check with recorded seeds.
- ≥ 1,000 seeded full matches replay to the same state hash, with 0 tile-conservation violations and 0 illegal moves
  accepted.
- Index: `T-COMPLETE`, `T-SOUND`, `T-ORACLE` green; `has()` < 5 µs on Node; two builds byte-identical.
- Lexicon ≥ 800 playable forms including ≥ 30 two-letter forms, validator green (on track for 2,000 in ~2 sprints).
- Stretch (reported, not gated): bot no-legal-word turn rate, scoreless-ending rate, top-20 term share, engine
  games/s on the current lexicon.

## Tasks

| ID | Task | Owner agent | Depends on | Acceptance criteria | Size | Status |
|---|---|---|---|---|---|---|
| D1 | ADR-0013 Determinism and replay contract | solution-architect, game-engine-engineer | — | ADR accepted with RNG algorithm, stream derivation, action-log schema, state hash, `engineRulesVersion` policy; golden-vector format defined; open questions Q-G1–G4, Q-A1, Q-H3 of the lexicon-index note closed | S | done |
| D2 | `/feature-spec` E-1.7 playtest lexicon and inflections | product-strategist, lexicon-curator, game-designer | — | Spec Ready for design: inflection kinds, authoring rules, scoring of inflected forms, ≥ 2,000 forms / ≥ 30 two-letter target, content plan by batch, validator rules (global uniqueness, blocklist, regex) | M | done |
| D3 | Classic premium layout (A-02) and frozen default letter table | game-designer | — | `GAME_RULES.md` / `BALANCE.md` give the 15×15 premium layout and the frozen letter values/bag for `engineRulesVersion` 1; scoring golden cases written | S | done |
| D4 | Game-engine API note | game-engine-engineer | D1 | `docs/architecture/notes/game-engine-api.md`: `MatchConfig`, `MatchState`, `Action`, `Rejection`, `MatchEvent`, `Observation`, `ScoreBreakdown`, function signatures; reviewed by solution-architect and ai-engineer | S | todo |
| L1 | Canonical `lexiconVersion` (RFC 8785) and schema v2 with `inflections` | lexicon-engineer | D2 | Schema v2 + validator (uniqueness across forms and inflections, blocklist, regex); `lexiconVersion` stable across key order/whitespace (property test); LEXICON_SPEC updated; existing seed migrated | M | todo |
| L2 | Lexicon package to TypeScript and `@codelex/lexicon/index` types (`FormRef`/`TermRef`) | lexicon-engineer | D4 | Package builds with `@codelex/config` presets; `LexiconIndex`, `Gaddag`, errors and `decodeLexiconIndex` signatures exported; `pnpm lexicon:validate` unchanged | M | todo |
| L3 | Reference `LexiconIndex` (Set/Map) and its contract tests | lexicon-engineer | L1, L2 | `T-COMPLETE`, `T-SOUND`, `T-ORACLE` green on the seed; usable by engine tests | S | todo |
| E1 | Scaffold `packages/game-engine` and RNG with golden vectors | game-engine-engineer | D1 | Scaffolded with `/scaffold` (strict preset); xoshiro128** + stream derivation match ADR-0013 golden vectors; determinism lint green | S | todo |
| E2 | Board, bag, placement and validation (test-first) | game-engine-engineer | E1, D3, L3 | R-BOARD-*, R-BAG-*, R-TURN-* properties from RULE_PROPERTIES pass; rejection reasons typed | L | todo |
| E3 | Classic scoring and end rules (test-first) | game-engine-engineer | E2, D3 | R-SCORE-*, R-END-* properties and all golden cases pass; `ScoreBreakdown` matches the API note | M | todo |
| E4 | `apply` / `observe` / `stateHash` / `replay` and full-match property | game-engine-engineer | E3 | ≥ 1,000 seeded matches replay to identical hashes; 0 conservation violations; `P-GLOBAL-01..08` green; coverage ≥ 90 % | M | todo |
| C1 | Lexicon content batch 1 | lexicon-curator | L1 | ≥ 800 playable forms incl. ≥ 30 two-letter forms, EN/FR definitions, validator green | L | todo |
| L4 | DAWG build and binary codec (T5), size gate; GADDAG (T6) if capacity | lexicon-engineer | L3 | Byte-identical builds; `has()` < 5 µs on Node; index size gate in CI; decoder fuzz test | L | todo |
| U1 | E-1.5 design spec (flows, board, summary, Knowledge Card) | ux-ui-designer | — | `docs/specs/E-1.5-play-vs-bot/classic-match-vs-bot.design.md` covers every AC with screens, states, EN/FR copy, a11y | M | todo |
| B1 | Bots: random-legal + Beginner + simulator CLI (stretch) | ai-engineer | E4, L4 | `/scaffold packages/bots`; deterministic under seed; simulator reports the stretch metrics on the current lexicon | M | todo |
| Q1 | Sprint exit check | qa-engineer | E4, L4, C1 | Success indicators measured and recorded here; main green; `pnpm validate` passes | S | todo |

**Start in parallel:** D1 (ADR-0013), D2 (E-1.7 spec) and D3 (premium layout + letter table); U1 can run alongside.

## Risks

- Lexicon content is the main schedule risk (310 → 2,000 forms): curation starts in week 1 (C1 right after L1).
- Device word lookup ≤ 20 µs p99 without JIT on Hermes: Hermes benchmark joins CI from T5 next sprint.
- Determinism across Node and Hermes: no floats in scoring or RNG, explicit sort comparators, no Intl/locale
  compare, no reliance on Map/Set iteration order.
- `FormRef`/`TermRef` split touches every lexicon consumer: fixed in L2, not later.

## Decisions log
- 2026-10-02 — D1: ADR-0013 accepted (xoshiro128**, SHA-256 stream derivation, action log v1, state hash,
  `engineRulesVersion`); lexicon-index note Q-G1–G4, Q-A1, Q-H3 resolved.
- 2026-10-02 — D2: E-1.7 spec Ready for design (curated inflections, canonical-term resolution, 3 content batches).
- 2026-10-02 — D3: GAME_RULES v0.3 = `engineRulesVersion` 1 — original `classic-v1` layout, `letters-v1` table (also
  used for lexicon game values), 18 Classic + 4 inflection golden cases, E-1.7 confirmations C-GD-1..5, R-CORE-006.
- 2026-10-02 — E-1.5 open questions decided under delegation (see the spec's "Decisions" section).
