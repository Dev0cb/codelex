# @codelex/game-engine

Pure, deterministic rules engine shared by the server (`services/game`), the apps and the bots (board, bag,
placement, validation, scoring, powers, modes, replay). Contract: `docs/adr/0013-determinism-replay-contract.md`.

- Owner: `game-engine-engineer` (rules questions go to `game-designer`)
- Coverage preset: `strict`, 90 % on lines, statements, functions and branches (`@codelex/config/vitest`)
- Status: sprint E3 — RNG, SHA-256, JCS (E1/E1b); rules constants, `createMatch`, action parsing, bag and
  placement validation (E2); scoring, preview and end of match (E3). `apply` / `observe` / `stateHash` / `replay`
  arrive in E4.

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

- `ENGINE_RULES_VERSION` — integer rules version (ADR-0013 §D5), currently `1`.
- `sha256(bytes)`, `sha256Hex(bytes)`, `toHex(bytes)`, `asciiBytes(text)` — pure-TS SHA-256 (FIPS 180-4) for
  stream derivation and, from E4, the state hash. No `node:crypto`, no `TextEncoder`.
- `canonicalJson(value)` — RFC 8785 (JCS) text for the ADR-0013 §D3 subset only: plain objects, dense arrays,
  printable-ASCII strings (0x20–0x7E, keys included) and safe integers except `-0`; keys sorted by UTF-16 code
  units, nesting ≤ 64. Booleans, `null`, fractions and anything else throw (`TypeError` for a wrong kind of
  value, `RangeError` for a value out of range); the message gives the path, e.g. `$.seats[1].score`.
- `hash16(value)` — `hex(SHA-256(JCS(value)))[0..16)`, the `stateHash` format of ADR-0013 §D3.
- Types of `docs/architecture/notes/game-engine-api.md` §4–§12 (`MatchConfig`, `MatchState`, `Action`,
  `Rejection`, `EngineError`, `MatchEvent`, `ScoreBreakdown`, `MatchResult`, `EngineLexicon`, …).
- `getLayout('classic-v1')`, `getLetterTable('letters-v1')`, `RULES` — frozen `engineRulesVersion` 1 constants
  (GAME_RULES §2.1, §3.1); snapshot-tested against the rules text.
- `createMatch(config, ctx)` — API note §13.1: `RULES_VERSION_UNSUPPORTED` → `INVALID_CONFIG` →
  `LEXICON_MISMATCH`, then first seat (`first-player` stream), shuffled bag (`bag` stream) and deal.

Internal (used by `apply`/`evaluateMove` in E4, not exported yet): `parseAction` (untrusted shape →
canonical action or `malformed`), `validateAction` (full §8.3 precedence), `checkPlacementGeometry` /
`checkPlacement` (R-TURN-002/003/006, R-BOARD-004; formed words, main first), `drawTiles` / `refillRack` /
`exchangeTiles` (R-BAG-003/005), `scorePlacement` / `chainAfter` / `previewPlacement` (R-SCORE-001…005, 008, 009),
`finishMatch` / `endAdjustments` (R-SCORE-006, R-END-001…003; default readings of API note §16 Q-GD-2…4).
Scoring golden cases live in `test/golden/scoring/v1/` (RULE_PROPERTIES §3.1/§3.2, transcribed verbatim). Tests use `test/support/small-lexicon.ts` (G-LEX-SMALL on the lexicon's
reference index).

## Commands

```bash
pnpm turbo run build lint typecheck format:check test --filter=@codelex/game-engine
```

## Invariants

1. **Determinism.** Same inputs → bit-identical outputs on every runtime (Node 22, Hermes). 32-bit integer maths
   only (`Math.imul`, `>>> 0`); no `Date`, `Math.random`, `crypto`, I/O, BigInt, floats or unordered iteration in
   `src/` (lint-enforced, ADR-0013 §D4). Inputs are never mutated.
2. **Golden vectors are immutable once published.** `test/golden/rng.json` is a transcription of ADR-0013
   Appendix A (normative), `test/golden/sha256.json` holds the FIPS 180-4 / NIST CAVP vectors and
   `test/golden/jcs.json` holds Appendix A.3 plus subset and rejection cases. A failing
   golden test means the code is wrong: never edit a vector to make it pass. Changing the RNG, the derivation
   or the shuffle is an outcome change: bump `ENGINE_RULES_VERSION` and supersede the ADR.
3. **Streams are independent.** Adding a stream never changes existing ones; bots receive a derived `Rng`,
   never the seed (ADR-0013 §D9).
4. Lint, format and coverage rules come from `@codelex/config`; never lower a threshold or disable a rule here.
