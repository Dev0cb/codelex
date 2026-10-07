# @codelex/game-engine

Pure, deterministic rules engine shared by the server (`services/game`), the apps and the bots (board, bag,
placement, validation, scoring, powers, modes, replay). Contract: `docs/adr/0013-determinism-replay-contract.md`.

- Owner: `game-engine-engineer` (rules questions go to `game-designer`)
- Coverage preset: `strict`, 90 % on lines, statements, functions and branches (`@codelex/config/vitest`)
- Status: sprint E4 — the full `engineRulesVersion` 1 Classic engine of the API note: `createMatch`, `apply`,
  `observe` / `eventsFor`, `evaluateMove`, `previewScore`, `serializeState` / `parseState` / `stateHash`, action
  log and `replay`. 1,000 seeded full matches replay to identical hashes in CI (`src/match/simulation.test.ts`).

## API

### `@codelex/game-engine/rng` (ADR-0013 §D1; also re-exported from the root)

| Export                                             | Description                                                                             |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `deriveRng(seedHex, streamName): Rng`              | Generator of a named stream (`bag`, `first-player`, `bot:<seat>:<n>`) of a 64-bit seed  |
| `deriveStreamState(seedHex, streamName): RngState` | `SHA-256(seedHex ":" streamName)[0..16)` as 4 big-endian u32; all-zero → `[1, 0, 0, 0]` |
| `createRng(state): Rng`                            | Generator from a persisted state (e.g. `rng.bag`); the input is copied, never mutated   |
| `Rng.next()`                                       | One xoshiro128\*\* 1.1 step, unsigned 32-bit                                            |
| `Rng.int(lo, hi)`                                  | Uniform integer in `[lo, hi)` by rejection sampling (`hi - lo <= 2^32`, ≥ 1 draw)       |
| `Rng.shuffle(items)`                               | Descending Fisher–Yates on a copy (`j = int(0, i + 1)`)                                 |
| `Rng.state()`                                      | Frozen snapshot of the 4 state words                                                    |
| `isSeedHex`, `isStreamName`, `stateFromDigest`     | Validation and derivation helpers                                                       |
| `RNG_ALGORITHM`, `RNG_DERIVATION`                  | Identifiers recorded in `test/golden/rng.json`                                          |

Invalid seeds, stream names, states or ranges are programmer errors and throw `RangeError`; parse untrusted
input (action logs) before it reaches the RNG.

### `@codelex/game-engine`

- Rules registry (ADR-0014): `RULES_VERSIONS` (`[1, 2]`), `rulesFor(v)` (`RulesSet`: status, allowed layouts and
  letter tables, `rules`, draft `candidates`), `isRulesVersion`, `rulesDigest(v)` (pinned for frozen versions in
  `test/golden/rules-digests.json`). v1 is frozen (GAME_RULES 0.3.1). v2 is a **draft**: `classic-v2` (plain
  start) or `classic-v1`, `letters-v2` (placeholder copy of `letters-v1` until L7), term-bonus candidates
  `tb-0-2-4-8` (default) and `tb-0-3-6-12`. Versions differ in data only; lint bans version comparisons outside
  `src/rules/registry.ts`.
- `ENGINE_RULES_VERSION` (= 1, newest frozen) and `RULES` (= `rulesFor(1).rules`) — deprecated aliases (ADR-0014
  §D6), kept for one release; engine code never reads them.
- Types of `docs/architecture/notes/game-engine-api.md` §4–§12 (`MatchConfig`, `MatchState`, `Action`,
  `Rejection`, `EngineError`, `MatchEvent`, `ScoreBreakdown`, `MatchResult`, `EngineLexicon`, …).
- `getLayout(id)`, `getLetterTable(id)` — layouts (`classic-v1`, `classic-v2`) and letter tables (`letters-v1`,
  `letters-v2`); `classic-v1`/`letters-v1` are snapshot-tested against GAME_RULES §2.1, §3.1.
- `createMatch(config, ctx)` — API note §13.1: `RULES_VERSION_UNSUPPORTED` → `INVALID_CONFIG` →
  `LEXICON_MISMATCH`, then first seat (`first-player` stream), shuffled bag (`bag` stream) and deal.

- `apply(state, action, ctx)` — API note §13.2: §8.3 precedence (`validateAction`), then PLACE_WORD / EXCHANGE /
  PASS / RESIGN, end detection (R-END-001, R-END-002, R-TURN-004) and events (§9). Never mutates its input.
- `observe(state, viewer)`, `eventsFor(events, viewer)` — per-viewer projections (P-GLOBAL-07, P-API-03/04).
- `evaluateMove(observation, action, ctx)` — the bots' only scoring path (P-API-01: identical to `apply`).
- `previewScore(observation, tiles)` — lexicon-free projection (R-SCORE-009); `null` when geometry fails.
- `exchangeEligibility(observation)` — R-TURN-001 for the viewer: `{ ok, reason, minBag }`, the same bag check
  `apply` runs (`bag_too_small`), so clients never restate the rule.
- `termBonusTotal(breakdown)` — Σ of the per-word term bonuses (R-SCORE-003), the P-SCORE-009-c quantity.
- `serializeState`, `stateHash`, `parseState` — JCS text, its 16-hex SHA-256, and the validating parser
  (shapes, sorted racks, tile conservation, `result` iff finished).
- `newActionLog`, `serializeActionLog`, `parseActionLog`, `replay`, `LOG_VERSION` — ADR-0013 §D2 logs; replay
  verifies optional per-action and final hashes. `replay(log, ctx, { from, verify })` resumes from a snapshot
  verified against the log's checkpoint (API note §20 Q7); `verify: 'final'` checks only the last checkpoint.

### `@codelex/game-engine/draft` (ADR-0014 §D4)

`ALLOW_DRAFT_RULES` (and its type `DraftOptIn`) — the only way to reach a draft rules version:
`createMatch`/`apply`/`evaluateMove`/`replay` read `ctx.draft = { optIn, candidate? }`, `parseState`,
`parseActionLog` and `previewScore` take `{ draft }`. A draft log is reproducible only with its candidate (ADR-0014
§D4 amendment). Without it a draft is `RULES_VERSION_UNSUPPORTED` (`status: 'draft'`). Simulator
and tests only: lint bans the entry under `apps/**` and `services/**`.

### `@codelex/game-engine/canonical` (ADR-0016 §D3.2)

`canonicalJson(value)` (RFC 8785 text of the ADR-0013 §D3 subset; throws `TypeError`/`RangeError` outside it),
`isJcsInteger(value)` and `JCS_MAX_DEPTH` (64). The same function that `stateHash` uses, re-exported so that the
golden runner (`@codelex/golden-runner`) compares Node and Hermes reports byte for byte without a second
serialiser. Read-only: it adds no rule and changes no outcome.

SHA-256 (`src/hash/`) is internal since E4 (API note §3): callers hash states with `stateHash`. Internal rules modules: `actions/` (parse, validate), `placement/`, `bag/`, `scoring/` (score,
end; rules decided in GAME_RULES v0.3.1, API note §16 Q-GD-1…5), `state/`, `replay/`.

Tests: golden cases in `test/golden/` (RNG, SHA-256, JCS, scoring `v1`, replay `v1` GC-DET-01, `rules-digests.json`;
mutable draft replays in `drafts/v2/`, regenerated by `pnpm drafts:write` after an intentional draft change); rules
variants for the per-version properties in `test/support/variants.ts`; lexicon fixtures
in `test/support/` (`small-lexicon.ts` = G-LEX-SMALL; `play.ts` = seeded random-legal player on a synthetic
lexicon, used by the full-match properties; `gc-det-01-lexicon.ts` = the frozen GC-DET-01 lexicon, built from
`test/golden/replays/v1/gc-det-01.lexicon.json`). Decision tests for Q-GD-1…4: `src/match/decisions.test.ts`.

## Commands

```bash
pnpm turbo run build lint typecheck format:check test --filter=@codelex/game-engine
pnpm --filter @codelex/game-engine bench   # non-gating timings over GC-DET-01 (API note §18)
```

## Invariants

1. **Determinism.** Same inputs → bit-identical outputs on every runtime (Node 22, Hermes). 32-bit integer maths
   only (`Math.imul`, `>>> 0`); no `Date`, `Math.random`, `crypto`, I/O, BigInt, floats or unordered iteration in
   `src/` (lint-enforced, ADR-0013 §D4). Inputs are never mutated.
2. **Golden vectors are immutable once published.** `test/golden/rng.json` is a transcription of ADR-0013
   Appendix A (normative), `test/golden/sha256.json` holds the FIPS 180-4 / NIST CAVP vectors and
   `test/golden/jcs.json` holds Appendix A.3 plus subset and rejection cases; `test/golden/scoring/v1` and
   `test/golden/replays/v1` hold the rules golden cases and GC-DET-01 (log kept as JCS text). A failing
   golden test means the code is wrong: never edit a vector to make it pass. Changing the RNG, the derivation
   or the shuffle is an outcome change: bump `ENGINE_RULES_VERSION` and supersede the ADR.
3. **Streams are independent.** Adding a stream never changes existing ones; bots receive a derived `Rng`,
   never the seed (ADR-0013 §D9).
4. Lint, format and coverage rules come from `@codelex/config`; never lower a threshold or disable a rule here.
