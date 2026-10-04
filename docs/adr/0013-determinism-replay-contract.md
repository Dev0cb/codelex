# 0013 — Determinism and replay contract

- Status: Accepted (delegated by the product owner, 2026-10-02); partly superseded by ADR-0014 (§D6 single version per build, and the §D5 lexicon↔constants coupling sentence)
- Date: 2026-10-02
- Deciders: product owner (human, delegated), solution-architect, game-engine-engineer
- Reversibility: **One-way door** for anything written into a published action log or golden replay (log
  envelope, RNG algorithm, stream derivation, state-hash function) once competitive replays exist (Phase 2).
  Until then every element is reversible by bumping `engineRulesVersion` (§D5) and regenerating goldens. The
  compatibility policy (§D6) and the cross-runtime plan (§D8) are two-way doors.

> ADR-0011 is reserved for protocol/event versioning (E-2.3). This ADR is numbered 0013 on purpose.

## Context
Sprint task D1 (`docs/sprints/2026-10-02-phase1-engine-core.md`), required before any engine code (E1–E4).

- **Rules that demand it.** R-CORE-005 (pure `apply`, named RNG streams, bit-identical replay), R-CORE-004
  (first seat from the `first-player` stream), R-BAG-005 (Fisher–Yates bag, exchange reshuffle), R-BAG-006
  (blank designation is part of the action), R-TURN-005 (rejections are invisible), P-GLOBAL-01..04 and P-GLOBAL-07
  in `docs/game/RULE_PROPERTIES.md`, GC-DET-01, E-1.5 AC-20 (saved match → same state hash, "Send match log").
- **Runtimes.** The same engine runs on Node 22 (server, CI, simulator) and on Hermes (React Native, iOS and
  Android, no JIT on the reference mid-range Android). Hermes has no `node:crypto`; BigInt is slow there; JS
  transcendental `Math` functions are implementation-defined across engines. Bit-identical results on both
  runtimes are a hard requirement (P-GLOBAL-02).
- **Scale and lifetime.** Phase 1 logs are local and non-competitive. From Phase 2, ranked, tournament and Daily
  logs are the audit record (ADR-0004: "match log = seed + ordered actions, hash-checked") and must replay for
  disputes and integrity analysis long after the engine has moved on.
- **Open items this ADR must close.** A-01 of RULE_PROPERTIES (derived vs frozen letter values), and Q-G1–Q-G4,
  Q-A1, Q-H3 of `docs/architecture/notes/lexicon-index.md`.
- **Constraints.** ENGINEERING §3 (no `Date`, `Math.random`, unordered iteration; integer scoring), §2 (engine
  imports only lexicon types and pure utilities, so no `node:crypto`), CLAUDE.md §1.1–1.2.

## Options considered

### 1. Pseudo-random generator
| Option | Pros | Cons |
|---|---|---|
| **A. xoshiro128\*\*** (Blackman & Vigna) | 4 × u32 state, only shifts/xors/rotates and two `Math.imul` (exact 32-bit integer multiply on every engine); period 2¹²⁸−1; passes BigCrush; tiny | not cryptographic (not needed: the seed is the secret, §D9); all-zero state forbidden |
| B. PCG32 | excellent statistics, small | needs 64-bit multiply: BigInt (slow on Hermes) or hand-emulated 64-bit maths (error-prone) |
| C. sfc32 / mulberry32 | 32-bit, very small | mulberry32 has a 2³² period (too short for 10⁴-game simulations across streams); less studied |
| D. ChaCha20 / SHA-256 counter mode | cryptographic | ~10–50× slower on Hermes, overkill for a secret seed |

### 2. Per-stream state derivation from `(seed, streamName)`
| Option | Pros | Cons |
|---|---|---|
| A. murmur3 `fmix32` / splitmix32 over the string | fast | fmix32 mixes a 32-bit word, not a string: we would have to specify our own string-to-words construction and four seeds to fill 128 bits — an ad-hoc design with no external test vectors |
| **B. SHA-256 of `seedHex ":" streamName`, first 16 bytes** | standard (FIPS 180-4), vectors in every language, already required by the state hash (one primitive, one implementation), full 128-bit state with no correlation between streams; cost paid once per stream per match | ~10 µs on Node, est. < 0.5 ms on Hermes per stream (3 per match: negligible) |

### 3. State hash
| Option | Pros | Cons |
|---|---|---|
| **A. SHA-256 (pure TS) over RFC 8785 (JCS) canonical JSON, first 16 hex** | standard serialisation independent of key order and whitespace, diffable when a mismatch is investigated, reproducible in any language (Go realtime, Python analytics) | JSON is larger than a binary encoding (≈ 1 KB per state: irrelevant) |
| B. xxHash/FNV over a custom binary encoding | faster | custom encoding to specify and maintain; 64-bit xxHash needs 64-bit maths on Hermes; not diffable |

### 4. Old logs after a rules change
| Option | Pros | Cons |
|---|---|---|
| A. Refuse with a typed error | simple, single-version engine | old competitive matches become un-replayable |
| B. Keep every rule set inside the current engine | everything always replays | dead branches accumulate in the hottest, most-tested code |
| **C. Refuse in the current engine; replay old competitive logs with archived engine builds (Phase 2)** | engine code stays single-version; audit preserved where it matters | needs an archive and a replay worker (Phase 2) |

## Decision

All rules below are **normative**. "Integer" means a JS safe integer; "hex" means lowercase `[0-9a-f]`.

### D1. RNG — `@codelex/game-engine/rng`
- **Algorithm:** xoshiro128\*\* 1.1, state `s[0..3]` of unsigned 32-bit words, exactly as the reference C code:
  `result = rotl(s1 × 5, 7) × 9; t = s1 << 9; s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3; s2 ^= t; s3 = rotl(s3, 11)`.
  JS: multiplications with `Math.imul`, results normalised with `>>> 0`. No BigInt, no floating-point
  operations, no fractional literals.
- **Seed:** 64 bits written as exactly 16 lowercase hex chars (`^[0-9a-f]{16}$`), e.g. GC-DET-01's
  `0x00C0DE1E00000001` is `00c0de1e00000001`. Seeds are produced outside the engine by a CSPRNG (server; device
  `crypto.getRandomValues` for offline casual). Tests may use BigInt to generate seeds and format them.
- **Stream derivation:** `state = SHA-256(ASCII(seedHex + ":" + streamName))[bytes 0..15]` read as four
  **big-endian** u32 words `s0..s3`. If all four are zero (probability 2⁻¹²⁸), set `s0 = 1`.
- **Stream names** (`^[a-z][a-z0-9-]*(:[0-9]+)*$`, decimal integers without leading zeros):
  - `bag` — initial shuffle and every exchange reshuffle (R-BAG-005); its 4-word state lives in match state.
  - `first-player` — exactly one draw at creation: `firstSeat = int(0, nSeats)` (R-CORE-004); not stored.
  - `bot:<seat>:<n>` — the `bot:<seat>` family of R-CORE-005, refined: one fresh stream per bot decision, where
    `n` = number of actions in the action log before the bot's action. Bots are therefore stateless
    (`chooseAction(observation, ctx)`), a resumed match makes the same bot choices, and bot draws can never shift
    `bag` or `first-player` (R-CORE-005 b). Bots receive the derived RNG in `ctx`, **never the seed**.
  - New streams are added by name; adding one never changes existing streams (independence by construction).
- **`next(): u32`** — one xoshiro128\*\* step.
- **`int(lo, hi)`** — uniform integer in the half-open range `[lo, hi)`; requires `lo < hi` and
  `n = hi − lo ≤ 2³²` (else programmer error, thrown). Rejection sampling:
  `limit = 2³² − (2³² mod n)`; repeat `x = next()` until `x < limit`; return `lo + (x mod n)`. Always consumes
  ≥ 1 output (also when `n = 1`). All intermediate values are integers < 2³³, exact in JS.
- **Shuffle:** Fisher–Yates, descending: for `i` from `len − 1` down to `1`: `j = int(0, i + 1)`; swap `a[i]`,
  `a[j]`.
- **Bag procedure (implements R-BAG-005 exactly):** the unshuffled bag is the tile multiset in ascending
  code-unit order of the tile encoding (§D2: `?` blanks first, then `A`…`Z`); it is shuffled once with `bag`;
  draws take from index 0. Exchange: draw `k` tiles from the head, append the returned tiles in ascending
  code-unit order to the tail, then shuffle the whole bag with the continuing `bag` stream.
- **Golden vectors:** Appendix A is normative. They are stored as
  `packages/game-engine/test/golden/rng.json` (format below) and E1 must reproduce them bit for bit.

### D2. Action log (`logVersion` 1)
Pure JSON whose leaves are **integers and ASCII strings only** (no floats, booleans, `null`, or absent-vs-null
ambiguity). Parsing is strict: unknown keys or values outside the schema → `MALFORMED_LOG`.

```jsonc
{
  "logVersion": 1,
  "header": {
    "seed": "00c0de1e00000001",
    "engineRulesVersion": 1,
    "lexiconVersion": "<16 hex>",        // §D7
    "profileId": "global-ranked",
    "definitionHash": "<16 hex>",        // canonical profile definition hash (lexicon-index note §4.2)
    "config": { "mode": "classic", "format": "untimed-vs-bot", "seats": 2 }  // MatchConfig, see below
  },
  "actions": [
    { "seat": 0, "type": "PLACE_WORD", "tiles": [ { "row": 7, "col": 6, "tile": "A" }, { "row": 7, "col": 7, "tile": "i" } ] },
    { "seat": 1, "type": "EXCHANGE", "tiles": ["?", "Q", "U"] },
    { "seat": 0, "type": "PASS" },
    { "seat": 1, "type": "RESIGN" }
  ],
  "stateHashes": ["<16 hex>", "…"],       // optional; state hash after each action, same length as actions
  "final": { "stateHash": "<16 hex>", "actionCount": 4 }   // optional; present once the match is over
}
```

- **Tile encoding (shared with §D3):** `A`–`Z` = letter tile; `?` = blank on a rack or in the bag; `a`–`z` = a
  placed blank designated as that letter (R-BAG-006). A `PLACE_WORD` tile `i` consumes a `?` from the rack.
- **Coordinates:** 0-indexed integers, `row` top→bottom, `col` left→right (Classic start square (7, 7)).
- **Canonical form:** `PLACE_WORD.tiles` sorted by `(row, col)` ascending without duplicates; `EXCHANGE.tiles`
  sorted ascending by code unit. The engine canonicalises input actions; the log stores only the canonical form;
  replaying a non-canonical log fails with `MALFORMED_LOG`.
- **Only accepted actions are logged.** Rejections are invisible (R-TURN-005); a logged action that is rejected
  on replay is a divergence (`ACTION_REJECTED`).
- **Action types in `engineRulesVersion` 1:** `PLACE_WORD`, `EXCHANGE`, `PASS`, `RESIGN` (Phase-1 scope).
  Reserved for later rules versions, not accepted by v1: `USE_POWER`, `TIMEOUT`, and an optional integer field
  `at` = milliseconds since match start on the authoritative clock (required by timed formats, R-CORE-005 d).
  Absolute wall-clock time is never in a log.
- **`config`** is the engine's `MatchConfig` (field list owned by D4, `docs/architecture/notes/game-engine-api.md`)
  restricted to integers, ASCII strings, arrays and objects. It must contain everything `createMatch` needs
  besides the header fields (mode, format, number of seats, team structure).
- **No PII:** seats only. The seat → player mapping, timestamps and device data are service/app metadata outside
  the log (AC-20 "no PII" export).
- **`logVersion`** bumps when the envelope, the header or the encoding of an existing action type changes.
  New action types arrive with a new `engineRulesVersion`. Readers support every published `logVersion`.
- **Replay API outcome codes** (names final in D4): `LOG_VERSION_UNSUPPORTED`, `RULES_VERSION_UNSUPPORTED`,
  `LEXICON_MISMATCH`, `MALFORMED_LOG`, `ACTION_REJECTED {index, rejection}`, `HASH_MISMATCH {index, expected,
  actual}`. When `stateHashes` is present every checkpoint is verified, which pinpoints the first divergent action.

### D3. State hash
- **Definition:** `stateHash(state) = hex(SHA-256(UTF-8(JCS(serialize(state)))))[0..16)` — 16 lowercase hex
  chars (64 bits). The hashed document is exactly the serialised state of P-GLOBAL-04 (one document for
  persistence, resume and hashing).
- **SHA-256:** pure TypeScript inside `packages/game-engine` (no `node:crypto`, no `TextEncoder`), tested against
  the FIPS 180-4 / NIST CAVP vectors (empty string, `abc`, the 448-bit and 896-bit messages, one million `a`).
- **JCS:** the engine ships a canonical serialiser for a **restricted subset** of RFC 8785 — objects, arrays,
  ASCII-printable strings (0x20–0x7E), safe integers (`-0` forbidden). On that subset RFC 8785 reduces to: keys
  sorted by UTF-16 code units, no whitespace, minimal JSON string escaping (`\"`, `\\`), integers in shortest
  decimal form. Any other value is a programmer error (thrown). Tested differentially against an RFC 8785
  reference implementation (test-only dependency, justified in the E1 PR) and against Appendix A.3.
- **Hashed content** (field names illustrative; D4 fixes them, after which the GC-DET-01 hash freezes them under
  `engineRulesVersion` 1). The document contains **everything that determines future behaviour or the result,
  and nothing else**:
  - identity: `engineRulesVersion`, `seed`, `lexiconVersion`, `profileId`, `definitionHash`, `config`;
  - `firstSeat`; turn: seat on turn, turn number, scoreless counter (R-TURN-004), accepted action count;
  - `board`: one string per row, `.` empty, otherwise the §D2 tile encoding (premiums are layout constants of the
    rules version and are not stored; "newly covered" = was empty before the action);
  - `bag`: remaining tiles in draw order as one string; `rng.bag`: the 4 state words (integers);
  - racks: one string per seat, sorted ascending by code unit (a rack is a multiset; UI order is not state);
    retired racks of eliminated FFA seats (R-END-002) stay in their seat;
  - per seat: score, chain length `k` (R-SCORE-005), previous main word as its **form** (`""` if none; never a
    `TermRef`), best single-turn score (R-END-003 tie-break), seat status (active / resigned / forfeited /
    eliminated);
  - status and, once finished: end reason and result (winners or draw).
  - Later rules versions add clocks, power charges, Arena HP in the same way.
- **Excluded:** the `LexiconIndex` (only its identity above), score breakdowns and events (outputs, derivable by
  replay), rejections, bot internals, presentation state (animations, rack arrangement, think delays), derived
  caches (anchors, cross-checks), Knowledge-Card data, any wall-clock reading.
- **Scope of use:** divergence detection and replay verification only. 64 bits is ample against accidental
  collisions; it is **not** a security commitment. Anything adversarial (anti-tamper, commit-reveal) uses full
  SHA-256 and is designed by `security-engineer`.
- **Cost:** computed on demand (persistence checkpoint, end of match, replay, tests), not on every `apply`.

### D4. Determinism rules for `packages/game-engine` and `packages/bots`
Enforced by the `@codelex/config` game-engine/bots ESLint presets where marked (L), by tests otherwise.
1. **Integers only** in state, actions, scoring and RNG. No fractional numeric literals in engine source (L).
   Fractional multipliers are rationals: `floorDiv(a × num, den)` (e.g. ⌊x × 0.5⌋ = `floorDiv(x, 2)`, Compile
   ×1.5 = `floorDiv(x × 3, 2)`, Arena ×0.6 = `floorDiv(x × 3, 5)`), operands < 2²⁶. Bots use integers or
   fixed-point integers for every value that influences a choice.
2. **Banned** (L): `Math.random`, `Date`, `performance`, `crypto`, `Intl`, `BigInt` (outside tests),
   `Math.pow` / `**` on non-integers, `Math.sqrt`, `exp`, `log`, trigonometric functions, `localeCompare`,
   `toLocale*`, `String.prototype.normalize`, `Array.prototype.sort()` without a comparator, `JSON.stringify` for
   anything hashed or compared (use the canonical serialiser), async code.
3. **Sorting:** every sort has an explicit comparator defining a **total order** (ties broken down to full
   identity, so sort stability is never relied on); strings compare by code unit
   (`a < b ? -1 : a > b ? 1 : 0`).
4. **Iteration order:** no output (state, events, hash, bot choice) may depend on `Map`/`Set`/object-key iteration
   order; iterate sorted keys or arrays. Objects are not used as maps with integer-like keys.
5. **Strings:** engine data is ASCII; no case folding beyond validated ASCII, no regex `i`/`u` flags on game data.
6. **Budgets, not clocks:** bots stop on node/candidate budgets (counts), never elapsed time. "Thinking" delays are
   presentation, outside the engine and outside the log (R-MODE-CLASSIC-002).
7. **Bot ties:** candidate moves are ranked by an integer score, ties broken by the canonical action encoding
   (§D2) in code-unit order; randomness only from `ctx.rng` (`bot:<seat>:<n>`).
8. **Bounded recursion** (depth ≤ 64): Hermes' native stack is smaller than V8's.

### D5. `engineRulesVersion`
- Integer ≥ 1, exported as `ENGINE_RULES_VERSION` by `@codelex/game-engine`, stored in the log header and the
  state. The package semver is never used for pinning.
- **Definition:** two engine builds reporting the same `engineRulesVersion` produce identical outcomes
  (accept/reject, state, state hash) for every log. Therefore it is bumped by any change that alters an outcome
  for some log: rules, constants (letter values, bag, layouts, bonuses), RNG or derivation, shuffle or bag
  procedure, serialisation or hash format, and additive changes (a new action type or mode) as well. Refactors and
  performance work do not bump it.
- **Frozen tables (closes A-01):** the Classic letter values and bag distribution are constants of the rules
  version. The R-BAG-001 / BALANCE.md derivation from lexicon letter frequencies runs **offline** (tooling, using
  `LexiconIndex.letterCounts()`), and its result is reviewed and frozen into the table of a rules version. The
  engine never derives values at runtime, so a lexicon release (new `lexiconVersion`) never changes scoring. The
  table for `engineRulesVersion` 1 is task D3 (`game-designer`, `docs/game/GAME_RULES.md` / `docs/game/BALANCE.md`);
  it must equal the LEXICON_SPEC §4 `letterValue` table used for `gameValue`, or both change together.
- **Process:** a PR that changes outcomes bumps the constant, adds `test/golden/replays/v<N>/`, and records the
  mapping "GAME_RULES version ↔ engineRulesVersion" in the GAME_RULES changelog. Golden files of a published
  rules version are immutable; a CI check fails any modification of `test/golden/replays/v<M>/` for `M <` the
  current version.

### D6. Replay compatibility policy (option C)
- The engine implements exactly one rules version. `createMatch`, `apply` and `replay` on any other version
  return `RULES_VERSION_UNSUPPORTED` (typed, never a silent replay under new rules).
- **Phase 1 (offline casual):** a local in-progress match from an older rules version cannot be resumed after an
  app update; the app shows a dedicated state and offers a new match (non-competitive, no stakes). Bumps during
  the playtest are deliberate and rare.
- **Phase 2 (server):** a live match finishes on the rules version it started with (same principle as the pinned
  `lexiconVersion`, LEXICON_SPEC §6). `services/game` runs the current and previous rules versions during rolling
  deploys. Competitive logs (ranked, tournament, Daily) are replayed by a replay worker that loads the archived
  engine build of their version (immutable artefact registered as `engineRulesVersion → git SHA + artefact
  digest`); archived builds are kept for as long as competitive logs of that version are retained (retention set
  by `privacy-compliance`). The stored result and hashes remain the record of truth beyond that.

### D7. Canonical `lexiconVersion` (rule; field list in LEXICON_SPEC via task L1)
`lexiconVersion = hex(SHA-256(UTF-8(JCS(D))))[0..16)` where `D` is the canonical document of the **playable
lexicon content**: every field encoded in the `.clxi` index or able to change any engine-, bot- or index-observable
answer (forms and inflections, `playable`, difficulty, categories and the category id registry, relations, tags
used by profiles, computed or overridden `gameValue`/`knowledgeXp`, blocklist). Arrays without semantic order are
sorted by explicit code-unit comparators; the result is independent of file layout, key order, whitespace, line
endings and OS. Display-only content (definitions EN/FR, `display`, `owner`, `sources`, category names, icons) is
**excluded** and versioned by the cards artefact's own content hash, so a definition fix never invalidates
replays or pins. Full RFC 8785 applies (lexicon content may be non-ASCII); the build may use `node:crypto`. An
index artefact is identified by (`lexiconVersion`, `profileId`, `definitionHash`), all three in the log header.

### D8. Node ↔ Hermes cross-runtime check
1. **This sprint (E1, E4):** golden suites run by Vitest on Node 22 in CI: `rng.json`, `sha256.json`,
   `jcs.json`, `replays/v1/*.json` (≥ GC-DET-01 plus a corpus of seeded full matches with `stateHashes`).
2. **Next sprint (with lexicon T5):** a CI job bundles a Vitest-free golden runner (pure TS, same files) into one
   script and executes it with the `hermes` CLI **of the exact Hermes version shipped by the pinned Expo SDK**;
   its JSON output is diffed against Node's. Any difference fails CI and blocks release.
   *Implementation note (sprint 3, P3).* Golden immutability is enforced by `tools/golden/immutability.mjs`
   (CI job "Golden immutability"; protected paths in `tools/golden/protected-paths.json`; tests in
   `tools/golden/immutability.test.mjs`; local run `pnpm golden:immutability`): published goldens may be added to, never
   modified or deleted, and `rules-digests.json` is append-only (ADR-0014 §D3). Draft goldens live in
   `test/golden/drafts/` and are not covered. The Hermes parity job is **not yet implemented**: the pinned
   `hermes-compiler` 250829098.0.17 ships `hermesc` only (compile-only, "does not support -exec"), and no runnable
   `hermes` VM CLI is available from the Expo SDK 57 / React Native 0.86.3 dependency tree. Adding one needs a
   dependency decision (see the P3 report in the sprint plan).
3. **Device:** the E-1.5 AC-20 replay check runs on the reference Android device in the mobile E2E/perf suite
   (`mobile-engineer`); playtest "Send match log" exports are replayed on Node during triage.
4. **Later:** browsers (spectating/replays on web) join through Playwright when the engine first runs there.

### D9. Hidden information and seed secrecy
The seed and `rng.bag` reveal the whole bag order. Observations (P-GLOBAL-07) exclude seed, RNG state and bag
order; bots get only a derived `bot:` stream. In online play (Phase 2) the seed never leaves the server before
the match ends; logs with seeds are released only for finished matches. Offline casual matches hold everything
on device by design (non-competitive, R-CORE-002). A derived seed for public content (e.g. Daily #N, A-07) must
not be predictable before release; its construction is part of the Daily design with `security-engineer`.

## Consequences

### Positive
- One small set of primitives (xoshiro128\*\*, SHA-256, JCS subset), each with external test vectors, gives RNG,
  stream derivation, state hash and `lexiconVersion` the same verifiable foundation in TS and in any future
  Go/Python consumer.
- Lexicon releases and rules releases are decoupled: content batches (C1, every few days) never change scoring or
  invalidate replays; rules changes are explicit, counted and golden-tested.
- Stateless bots with per-decision streams make resume, simulation and bug reproduction trivial.

### Negative / costs
- Engine carries its own SHA-256 and canonical serialiser (≈ 200 lines + vectors).
- Phase-1 players lose an in-progress casual match across a rules bump; Phase 2 needs an archive and replay worker.
- The banned-API list constrains bot heuristics to integer/fixed-point maths.

### Budgets (estimates until measured in E1/E4 and the Hermes job)
| Item | Budget / estimate |
|---|---|
| `rng.next()` | < 50 ns Node, < 1 µs Hermes |
| Stream derivation | < 20 µs Node, < 0.5 ms Hermes, 3 per match |
| `stateHash` (≈ 1 KB document) | < 50 µs Node, < 2 ms Hermes; never on the per-`apply` hot path |
| Full replay of a Classic 1v1 (≈ 30–40 actions) | < 40 ms Node (apply p99 < 1 ms, agent rule) |
| Log size | ≈ 3–5 KB JSON per 1v1 match, ≈ 1 KB gzipped; ≈ 5 GB/day raw at 1 M matches/day (Phase 2) |

### Observability
`codelex_game_replay_divergence_total{runtime, engine_rules_version}` (server replay worker, Phase 2; alert on
any increase); Sentry event on any state-hash mismatch in playtest builds (E-1.5 metric "engine/app score
mismatch": any occurrence); CI golden-suite and Hermes-diff results as release gates.

### Resolved questions (lexicon-index note §9, RULE_PROPERTIES §6)
- **A-01 / Q-G4 — letter values and bag:** frozen per `engineRulesVersion` (§D5); derivation is offline, uses raw
  `letterCounts()` (the schema has no "term frequency class"; any weighting is a `game-designer` choice inside the
  D3 tooling), and the build does **not** embed a bag. One table per board variant per rules version; lexicon
  profiles (season, org) do not change letter values or the bag.
- **Q-G1 — lexicon injection:** accepted. The engine receives the index as `ctx.lexicon`; `createMatch`, `apply`
  and `replay` compare (`version`, `profile.id`, `profile.definitionHash`) with the state and return a typed
  `LEXICON_MISMATCH` engine error (not a player `Rejection`; state unchanged) on difference.
- **Q-G2 — word lookup shape:** `lookupCodes(codes, from, to)` is the contract; no cursor API. Revisit only if
  profiling shows word extraction > 20 % of `apply` time.
- **Q-G3 — chain relations:** confirmed undirected (already R-SCORE-005 a). Distance 1 is a direct edge between two
  in-profile playable terms (adjacency only contains in-profile terms), so nothing links "through" an
  out-of-profile term. Chains resolve on canonical terms (`TermRef`): an inflection and its canonical term (POD →
  PODS) are the **same term**, hence not a link (R-SCORE-005 d). The state stores the previous main word as its
  form, resolved through the pinned index.
- **Q-A1 — GADDAG variant:** node-final GADDAG + `crossCheck` is sufficient for Phase 1; no arc-final letter sets
  or remaining-length bounds in format v1. Trigger to add an optional section (new `formatVersion`, a two-way
  door): Beginner/Strategist compute p95 on the reference device > 50 % of the 2 s budget (E-1.5 AC-8) in B1 or
  the next-sprint Hermes benchmark.
- **Q-H3 — profile semantics:** `global-ranked` contains **every** playable term; `season:*` tags are thematic
  (missions, highlights, Knowledge) and never remove a term. A season-pack profile is a **superset**
  (`global-ranked` ∪ pack terms), never "season tag only" (too thin to play, and a word valid in ranked must not be
  rejected in an event). Terms exclusive to a pack use a distinct `pack:<id>` tag and are excluded from
  `global-ranked` by its profile definition. Org (B2B/EDU) profiles may be subsets.

### Follow-up tasks
| Owner | Task | Acceptance criteria |
|---|---|---|
| `game-engine-engineer` | E1: RNG, SHA-256, JCS subset, golden files | Appendix A reproduced; NIST SHA-256 vectors; JCS differential test; coverage ≥ 90 % |
| `game-engine-engineer` | D4 API note: final state field names, `MatchConfig`, error codes of §D2 | reviewed by solution-architect; GC-DET-01 hash recorded in `replays/v1/` |
| `game-engine-engineer` | E4: log parser, `replay`, `stateHashes` verification | ≥ 1,000 seeded matches replay to identical hashes; malformed/non-canonical logs rejected |
| `devops-sre` | Determinism lint (§D4) in the game-engine and bots presets; golden-immutability CI check (§D5) | fixtures that must fail for each banned API; modifying a published `replays/v<M>/` fails CI |
| `devops-sre`, `mobile-engineer` | Hermes golden job (§D8.2), next sprint | Hermes version read from the Expo SDK pin; diff vs Node is a required check |
| `game-designer` | D3 frozen table; amend R-BAG-001 ("frozen per `engineRulesVersion`"), R-CORE-005 and P-GLOBAL-02 (`engineVersion` → `engineRulesVersion`; `bot:<seat>:<n>`) | GAME_RULES changelog maps v0.2 ↔ `engineRulesVersion` 1 |
| `lexicon-engineer` | L1: `lexiconVersion` per §D7; cards content hash | property test: stable across key order, whitespace, CRLF, file split |
| `lexicon-curator` | `global-ranked` profile file; `pack:<id>` tag namespace (Q-H3) | validator accepts the namespace; profile resolves to all playable terms |
| `ai-engineer` | Bots per §D4.6–7 and per-decision streams | same observation + seed ⇒ same action on Node and Hermes |
| `ux-ui-designer`, `mobile-engineer` | "Match from an older version can't be resumed" state (§D6) | EN/FR copy; analytics event |
| `security-engineer` | Threat model before E-2.3: seed secrecy, log tampering, Daily seed predictability (§D9) | documented and linked from this ADR |

### Revisit triggers
Hermes and Node diverge on any golden (fix the cause; if a primitive is at fault, supersede this ADR with a new
rules version); state hashing exceeds 10 % of server `apply` time; a need for adversarial guarantees on state
hashes; a third runtime with different integer semantics.

## Appendix A — Golden vectors (normative)

Computed with a throwaway Node implementation and cross-checked against the reference C implementation of
xoshiro128\*\* (all streams below identical) and coreutils `sha256sum` for the derivation. Sanity check of the bare
generator: state `[1, 2, 3, 4]` → `11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849`.

### A.1 File format — `packages/game-engine/test/golden/rng.json`
```jsonc
{
  "format": 1,
  "algorithm": "xoshiro128**-1.1",
  "derivation": "sha256(seedHex ':' stream)[0..16) as 4 big-endian u32",
  "cases": [
    {
      "seed": "00c0de1e00000001", "stream": "bag",
      "state": [1397353060, 410318920, 20514157, 3512332132],
      "next": [ /* first 8 outputs, decimal u32 */ ],
      "int": [ { "lo": 0, "hi": 2, "values": [/* 8 */] }, { "lo": 0, "hi": 100, "values": [/* 8 */] } ],
      "shuffle": { "input": [0,1,2,3,4,5,6,7,8,9], "output": [/* 10 */] }
    }
  ]
}
```
Each case starts from the freshly derived state; `next`, each `int` series and `shuffle` restart from it.
Companion files: `sha256.json` (NIST vectors), `jcs.json` (A.3 and subset cases), `replays/v<N>/*.json`
(full action logs per §D2 with `stateHashes` and `final`).

### A.2 RNG vectors
| Seed | Stream | Derived state (hex) | `next()` × 8 | `int(0,2)` × 8 | `int(0,100)` × 8 | shuffle 0..9 |
|---|---|---|---|---|---|---|
| `0000000000000000` | `bag` | `99805529 f8e444d6 53081084 f32c3c55` | 269275870, 2116113390, 1373333181, 205058767, 1741533037, 3064314973, 572461789, 1167382265 | 0,0,1,1,1,1,1,1 | 70,90,81,67,37,73,89,65 | 8,6,2,7,3,1,4,5,9,0 |
| `0000000000000000` | `first-player` | `d93b98bb 34a3cd62 e3397df7 ab8188c4` | 1703746843, 705170500, 1655515556, 3657206767, 3412167901, 2799693069, 2142632931, 4020600357 | 1,0,0,1,1,1,1,1 | 43,0,56,67,1,69,31,57 | 2,5,0,9,6,1,8,4,7,3 |
| `0000000000000000` | `bot:1` | `c7360f9d 0472697e 455ab4b9 1dba08b5` | 239440739, 3044862919, 1494418675, 1836735632, 2947126269, 3603929193, 3434560934, 3693078299 | 1,1,1,0,1,1,0,1 | 39,19,75,32,69,93,34,99 | 0,8,6,2,5,7,4,3,1,9 |
| `00c0de1e00000001` | `bag` | `5349ea64 1874f848 0139056d d159ef64` | 1204966949, 1544239233, 1025015925, 1571986059, 3784047710, 690393948, 1329916797, 519333301 | 1,1,1,1,0,0,1,1 | 49,33,25,59,10,48,97,1 | 6,7,4,1,3,2,8,5,0,9 |
| `00c0de1e00000001` | `first-player` | `d1a2f555 e0ba114f 4022d1dc 7de3f2d2` | 1518695225, 2646206451, 3237895804, 3630301370, 4226537663, 485773392, 1911679593, 4080278597 | 1,1,0,0,1,0,1,1 | 25,51,4,70,63,92,93,97 | 6,8,7,1,2,9,3,4,0,5 |
| `00c0de1e00000001` | `bot:1` | `a49bb515 e8f1a1d7 0ac776ab 35c39df7` | 1018783734, 1025915952, 1801117189, 1447024686, 4062369154, 895569284, 906752154, 2752915561 | 0,0,1,0,0,0,0,1 | 34,52,89,86,54,84,54,61 | 0,8,1,6,7,9,2,5,3,4 |
| `ffffffffffffffff` | `bag` | `38ff05fb d913e14d 58144f95 b09a23f7` | 1062028686, 1527420496, 1040650223, 2947950443, 3809001709, 1021097739, 832521904, 2458892651 | 0,0,1,1,1,1,0,1 | 86,96,23,43,9,39,4,51 | 5,3,2,0,9,1,8,7,4,6 |
| `ffffffffffffffff` | `first-player` | `acb57d1b 033411eb 890c70b3 6477aa52` | 328411080, 1727784672, 3332172578, 3083133038, 3221297362, 3949116539, 4269193738, 371456155 | 0,0,0,0,0,1,0,1 | 80,72,78,38,62,39,38,55 | 3,9,1,7,5,4,8,2,6,0 |
| `ffffffffffffffff` | `bot:1` | `463c6429 99321ede 026cf4c7 fce47f40` | 3887499118, 696203633, 792116245, 2252109190, 2229644420, 3958030757, 2965712367, 1287389767 | 0,1,1,0,0,1,1,1 | 18,33,45,90,20,57,67,67 | 0,4,1,3,7,6,9,5,2,8 |

`bot:1` vectors test the derivation of a `bot:` name; real bot decisions use `bot:<seat>:<n>` (§D1).

**Rejection-sampling vector.** Seed `00c0de1e00000001`, stream `bag`, `int(0, 3221225472)` × 8 (n = 3·2³⁰,
limit = n, so raw outputs ≥ 3221225472 are rejected) =
`1204966949, 1544239233, 1025015925, 1571986059, 690393948, 1329916797, 519333301, 2893210056`
(the raw outputs 3784047710 and 3400854581 are rejected; 10 raw draws consumed).

### A.3 Canonical JSON and state-hash vector
Input `{"z":{"k":-7},"b":0,"a":[3,"?AE"]}` → JCS `{"a":[3,"?AE"],"b":0,"z":{"k":-7}}` → SHA-256
`29cb9747b6a7224168208f209044e3d24573275df767bf9d09003cf5ef3ef7cb` → `stateHash`-style truncation
`29cb9747b6a72241`.
