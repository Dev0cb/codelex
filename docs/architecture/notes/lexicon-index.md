# Design note — `LexiconIndex` and the GADDAG build (E-1.2)

- Status: Proposed · Date: 2026-10-02 · Owner/author: lexicon-engineer
- Sprint: `docs/sprints/2026-10-02-phase0-close.md` — P3 (this note). Review required: `game-engine-engineer`
  (interface), `ai-engineer` (move-generation API); FYI `mobile-engineer` (loading), `lexicon-curator` (profiles).
- Inputs: `docs/game/LEXICON_SPEC.md`, `docs/game/GAME_RULES.md` (R-CORE-001/003, R-TURN-003, R-SCORE-003/005,
  R-BOARD-003, R-BAG-001), `docs/game/BALANCE.md`, `docs/architecture/ARCHITECTURE.md` (§3.4, §5),
  `docs/adr/0006-knowledge-graph-storage.md`, `docs/adr/0012-lint-format-toolchain.md`,
  `docs/architecture/notes/config-package.md`, `docs/specs/E-1.5-play-vs-bot/classic-match-vs-bot.md`.

All sizes and timings in this note are **estimates** unless explicitly marked *measured*. The only measured
numbers are automaton node/edge counts from a throwaway prototype script run on today's seed (310 playable forms);
no benchmark of a real implementation exists yet.

## 1. Purpose and scope

E-1.2 delivers, in `packages/lexicon`:

1. a **pure, synchronous** `LexiconIndex` that `packages/game-engine` uses for R-TURN-003 (word validity), term
   bonus (R-SCORE-003), chain bonus (R-SCORE-005), tech squares (R-BOARD-003) and bag derivation inputs (R-BAG-001);
2. a **GADDAG traversal API** that `packages/bots` uses for move generation (anchors + cross-checks);
3. a **deterministic build** turning `packages/lexicon/data` + a lexicon profile into one compact binary artefact
   per (`lexiconVersion`, profile), plus a manifest.

Non-goals: Knowledge Card content (definitions EN/FR, display, sources) — shipped as a separate, lazily loaded
"cards" artefact (§3.6), never on the engine path; search/graph APIs of `services/knowledge` (ADR-0006).

## 2. Interface

### 2.1 Where the types live
ENGINEERING §2 and the boundary table in the config note allow `packages/game-engine` to import only
`packages/lexicon` **types** and `@codelex/config/result`. Therefore:

- `@codelex/lexicon/index` exports the **types** below and the pure decoder `decodeLexiconIndex`.
- The engine imports types only and receives the instance by injection (`ctx.lexicon`). `services/game`,
  `apps/mobile` and `packages/bots` import the decoder and inject the instance.
- The decoder is pure TypeScript (no Node built-ins, no IO): it runs unchanged on Node (server), Hermes (mobile)
  and in Vitest. Reading bytes and verifying the content hash are the platform loader's job (§3.5).

### 2.2 Engine-facing interface

*Implemented 2026-10-02 (sprint L2):* the normative source is `packages/lexicon/src/index/types.ts`, exported as
`@codelex/lexicon/index`; the block below mirrors it. Amendments to the first draft of this note: the E-1.7
`FormRef`/`TermRef` split (`lookup`/`lookupCodes` return a `FormRef`; `termOf` resolves it to the canonical
`TermRef`; `formMeta` gives the played form and its kind; `size` counts forms, `termCount` terms); member names
confirmed in §9 Q-L13.

```ts
import type { Result } from '@codelex/config/result';

/** 16 lowercase hex chars; the value printed by `pnpm lexicon:validate` (see §4.1). */
export type LexiconVersion = string & { readonly __brand: 'LexiconVersion' };
export type Difficulty = 'novice' | 'intermediate' | 'advanced' | 'expert';
export type CategoryId = string & { readonly __brand: 'CategoryId' };
export type RelationType =
  | 'is_a' | 'part_of' | 'uses' | 'related_to' | 'alternative_to' | 'runs_on' | 'implements';

/** 0 = 'A' … 25 = 'Z'. Hot paths take letter codes to avoid building strings. */
export type LetterCode = number;
/** Bit i set ⇔ letter code i allowed (26 bits). */
export type LetterMask = number;
/** Bit k set ⇔ relation type k (order of RelationType above), either direction. 0 = not related. */
export type RelationMask = number;

export type InflectionKind = 'plural' | 'verb_s' | 'verb_ed' | 'verb_ing';
export type FormKind = 'canonical' | InflectionKind;

/**
 * A playable string (canonical form or declared inflection) **inside one artefact**: dense ordinal
 * 0..size-1, forms sorted by UTF-16 code-unit order. Never persist a FormRef: persist the form string.
 */
export type FormRef = number & { readonly __brand: 'FormRef' };
/**
 * A canonical playable term (metadata, relations) **inside one artefact**: dense ordinal 0..termCount-1, terms
 * sorted by canonical form. Never persist a TermRef (replays, events, saves): persist the term `id` or `form`.
 */
export type TermRef = number & { readonly __brand: 'TermRef' };

export type LexiconProfileKind = 'global' | 'season' | 'org';
export interface LexiconProfileRef {
  readonly id: string;              // e.g. 'global-ranked', 'season-s01-the-cloud', 'org-<orgId>'
  readonly kind: LexiconProfileKind;
  readonly definitionHash: string;  // 16 hex; hash of the canonical profile definition (§4.2)
}

export interface TermMeta {
  readonly ref: TermRef;
  readonly id: string;                         // stable term id (analytics, Knowledge Card)
  readonly form: string;                       // canonical form ^[A-Z]{2,15}$, never an inflection
  readonly difficulty: Difficulty;             // R-SCORE-003
  readonly categories: readonly CategoryId[];  // first = primary; R-BOARD-003 uses all of them
  readonly gameValue: number;                  // formulas.mjs, or approved override
  readonly knowledgeXp: number;                // formulas.mjs, or approved override
}

/** A playable form and its canonical term (R-CORE-006; E-1.5 "Played as PODS", chip deduplication). */
export interface FormMeta {
  readonly ref: FormRef;
  readonly form: string;                       // the played string
  readonly term: TermRef;                      // = termOf(ref)
  readonly kind: FormKind;
}

export interface LexiconIndex {
  readonly version: LexiconVersion;
  readonly profile: LexiconProfileRef;
  readonly formatVersion: number;   // binary format version (decoder supports a set of them)
  readonly size: number;            // number of playable forms (canonical + inflections) in this profile
  readonly termCount: number;       // number of canonical playable terms (≤ size)
  readonly maxFormLength: number;   // ≤ 15

  // --- R-CORE-003 / R-TURN-003: membership (budget < 5 µs, allocation-free) ---
  /** false for anything that is not ^[A-Z]{2,15}$ (no case folding, no locale logic). */
  has(form: string): boolean;
  lookup(form: string): FormRef | undefined;
  /** Same as lookup over codes[from, to); used by the engine when reading words off the board. */
  lookupCodes(codes: ArrayLike<LetterCode>, from: number, to: number): FormRef | undefined;

  // --- forms → terms (R-CORE-006) ---
  termOf(form: FormRef): TermRef;                     // PODS → POD, POD → POD
  formMeta(form: FormRef): FormMeta;                  // memoised, frozen objects

  // --- term metadata ---
  meta(term: TermRef): TermMeta;                      // memoised, frozen objects; .form is canonical
  difficulty(term: TermRef): Difficulty;              // hot-path accessor, no allocation
  inCategory(term: TermRef, category: CategoryId): boolean;
  categories(): readonly CategoryId[];                // ids present in this profile, sorted

  // --- R-SCORE-005 chain bonus: graph distance 1, any typed relation, undirected ---
  related(a: TermRef, b: TermRef): RelationMask;      // 0 if not related (and for a === b); O(log degree)
  neighbours(term: TermRef): readonly TermRef[];      // sorted ascending; only terms in this profile

  // --- R-BAG-001 inputs (the distribution formula itself stays in the engine) ---
  /** occurrences of each letter across all forms of the profile; index = LetterCode. */
  letterCounts(): Readonly<Uint32Array>;

  // --- move generation (packages/bots) ---
  readonly gaddag: Gaddag | undefined;                // undefined if the artefact omits the section
  /** Letters L such that before + L + after is a playable form (DAWG walk, ≤ 26 suffix walks). */
  crossCheck(before: ArrayLike<LetterCode>, after: ArrayLike<LetterCode>): LetterMask;
}

export type LexiconIndexErrorCode =
  | 'BAD_MAGIC' | 'UNSUPPORTED_FORMAT' | 'TRUNCATED' | 'CORRUPT'      // structure / CRC32 failure
  | 'VERSION_MISMATCH' | 'PROFILE_MISMATCH' | 'UNSUPPORTED_PLATFORM'; // e.g. big-endian host
export interface LexiconIndexError {
  readonly code: LexiconIndexErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, string | number>>;
}

export interface LexiconIndexExpectation {
  readonly version?: LexiconVersion;
  readonly profileId?: string;
}

/** Pure; never throws on bad input; zero-copy views over `bytes` when 4-byte aligned, else one copy. */
export type DecodeLexiconIndex = (
  bytes: Uint8Array,
  expect?: LexiconIndexExpectation,
) => Result<LexiconIndex, LexiconIndexError>;
export const decodeLexiconIndex: DecodeLexiconIndex;
```

Runtime values exported next to the types (sprint L2): `DIFFICULTIES`, `RELATION_TYPES` (index k = bit k of a
`RelationMask`, append-only), `INFLECTION_KINDS`, `FORM_KINDS`, `LETTER_COUNT`, `GADDAG_SEPARATOR`,
`MAX_FORM_LENGTH` (a unit test keeps the enums equal to `schema/term.schema.json`), `isLexiconVersion`,
`relationBit` / `hasRelation` / `relationTypesOf`, `CLXI_MAGIC`, `SUPPORTED_FORMAT_VERSIONS`. Until L4 ships
format 1, `decodeLexiconIndex` reads only the format prefix and answers `TRUNCATED`, `BAD_MAGIC` or
`UNSUPPORTED_FORMAT` (`SUPPORTED_FORMAT_VERSIONS` is empty): never a partial index. The build API (§3.2) is not
exported yet (L4).

Design choices:

- **Absence is not an error.** `has`/`lookup` return `boolean`/`undefined`; the engine maps a miss to its own
  domain error (`NOT_IN_LEXICON`, R-TURN-003). `Result` is used where failure is expected and must be handled:
  decoding (above) and building (§3.2).
- **No pinning logic inside the index.** The engine stores `lexiconVersion` and `profile.id` in match state at
  creation (R-CORE-001) and `apply` returns `Err({ code: 'LEXICON_MISMATCH' })` if `ctx.lexicon` differs. This is
  how "a match never changes lexicon mid-game" is enforced in code (proposal to `game-engine-engineer`).
- **Blanks** are resolved by the engine (the player chose the letter) before lookup; bots handle blanks during
  GADDAG traversal by trying every arc.
- `gameValue` is exposed for display/Daily; R-SCORE-003 uses `difficulty` only, as specified.

### 2.3 Move-generation interface (`packages/bots`)

```ts
/** 0..25 letters, 26 = separator ◇ (Gordon 1994). */
export type GaddagSymbol = number;
export const GADDAG_SEPARATOR = 26;
export type GaddagNode = number & { readonly __brand: 'GaddagNode' };

export interface Gaddag {
  readonly root: GaddagNode;
  /** Bits 0..25 = letter arcs, bit 26 = separator arc. Iterate set bits ascending ⇒ deterministic order. */
  arcs(node: GaddagNode): number;
  /** Target node, or -1 when the arc does not exist. O(1): mask test + popcount + one load. */
  next(node: GaddagNode, symbol: GaddagSymbol): GaddagNode | -1;
  /** True when the symbols read from the root spell rev(prefix) [◇ suffix] of a complete playable form. */
  isFinal(node: GaddagNode): boolean;
}
```

Each form `w` of length n is inserted as `rev(w[0..i]) ◇ w[i..n]` for i = 1..n−1, plus `rev(w)` (anchor on the
last letter). Generation from an anchor square walks left with the rack (reading reversed), crosses ◇, then walks
right, pruning with the per-square `LetterMask` from `crossCheck`.

Split of responsibilities (proposal to `ai-engineer`):

| Concern | Where |
|---|---|
| GADDAG automaton, `crossCheck`, `letterCounts` | `packages/lexicon` (this note) |
| Anchors (empty squares adjacent to tiles; centre square on move 1, R-TURN-002), per-square cross-check masks for a board and direction | `packages/bots` (board-derived, uses `crossCheck`) |
| Scoring of a candidate move | `packages/game-engine` (never re-implemented in bots, CLAUDE.md §1.2) |
| Vocabulary restriction by personality (e.g. Beginner avoids expert terms) | `packages/bots`, by filtering generated moves with `difficulty(ref)`; no per-personality automaton |

## 3. Build pipeline

### 3.1 Flow

```
data/terms/*.json, categories.json, blocklist/*.txt, profiles/<id>.json
  → loadLexicon() + validateLexicon()          (existing validate.mjs — the build refuses on any error)
  → resolveProfile(profile)                    (set algebra over tags/categories/ids, §4.2)
  → canonical model: forms sorted, TermMeta[], symmetric adjacency (CSR), letter counts
  → DAWG (minimised, rank-annotated)  +  GADDAG (minimised, optional section)
  → encode binary v1 (§3.3)  → <profile>.clxi  +  manifest.json entry (sha256, sizes, formatVersion)
```

### 3.2 Build API

```ts
export interface LexiconProfileDefinition {
  readonly id: string;
  readonly kind: LexiconProfileKind;
  readonly include: { readonly all?: true; readonly tags?: readonly string[];
                      readonly categories?: readonly string[]; readonly ids?: readonly string[] };
  readonly exclude?: { readonly tags?: readonly string[]; readonly ids?: readonly string[] };
}
export type LexiconBuildErrorCode =
  | 'VALIDATION_FAILED' | 'BLOCKLISTED_FORM' | 'EMPTY_PROFILE' | 'UNKNOWN_PROFILE_REFERENCE' | 'LIMIT_EXCEEDED';
export interface LexiconBuildError {
  readonly code: LexiconBuildErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, string | number>>;
}

export function buildLexiconIndex(
  lexicon: LoadedLexicon,                 // output of loadLexicon(); version taken from it
  profile: LexiconProfileDefinition,
  options: { readonly formatVersion: 1; readonly gaddag: boolean },
): Result<Uint8Array, LexiconBuildError>;
```

### 3.3 Binary format v1 (`.clxi`) — behind the interface, reversible

Little-endian, every section 8-byte aligned, zero padding, no timestamps, no absolute paths.

| Section | Layout | Notes |
|---|---|---|
| Header (fixed) | magic `CLXI`, `formatVersion` u16, flags u16, `lexiconVersion` (8 bytes), profile id + `definitionHash`, section table (offset, length), CRC32 of payload | CRC32 = corruption check, pure JS on every platform |
| STRINGS | UTF-8 pool: term ids, category ids, profile id | forms are not stored: reconstructed from the DAWG by rank when needed (`meta` memoises) |
| TERMS | per `TermRef`: difficulty u8, primary category u8, category bitmask u32 (≤ 32 categories in v1, `LIMIT_EXCEEDED` otherwise), gameValue u16, knowledgeXp u16, id string offset u32, adjacency offset u32 → 18 B, padded to 20 B | sorted by form |
| ADJ | CSR: sorted neighbour `TermRef` u32 + relation mask u8 per entry, symmetric, deduplicated, both ends in profile | R-SCORE-005 |
| LETTERS | 26 × u32 | R-BAG-001 input |
| DAWG | nodes: arc mask + final bit u32, first-edge u32 (8 B); edges: target u32, cumulative rank u32 (8 B) | `lookup` = O(len) walk; rank sum gives `FormRef` (minimal perfect hash); a FORMS→TERMS u32 table gives `termOf` |
| GADDAG (optional) | nodes: arc mask (27 bits) + final bit u32, first-edge u32 (8 B); edges: target u32 (4 B) | child = edges[first + popcount(mask & ((1 << s) − 1))] |

Popcount is a constant-time bit trick in JS (no `Math` intrinsic needed); every transition is a handful of typed
array reads, which is what makes the < 5 µs budget plausible (§5).

### 3.4 Where it runs
- **Phase 1:** `pnpm --filter @codelex/lexicon build:index` (Turborepo task, cached on inputs) writes
  `packages/lexicon/dist/indexes/<lexiconVersion>/<profileId>.clxi` and `manifest.json` (git-ignored; CI builds
  them; artefacts are reproducible so they are never committed). `apps/mobile` copies the bundled profile into
  its assets at build time.
- **Later (ARCHITECTURE §3.4):** `services/knowledge` publish runs the **same builder** (imports
  `@codelex/lexicon`) on the approved draft, uploads to object storage under an immutable key
  `lexicon/<lexiconVersion>/<profileId>/<definitionHash>.v<formatVersion>.clxi`, and registers it. Org-restricted
  profiles (B2B/EDU) are built only there, because org definitions are tenant data and never live in the repo.

### 3.5 Loading
- **Mobile (Hermes):** the `.clxi` is a bundled asset (Metro `assetExts` += `clxi`); read once into an
  `ArrayBuffer`, verify its sha256 against the bundled manifest with the platform digest (native, e.g. expo-crypto),
  then `decodeLexiconIndex` creates typed-array **views** over that buffer — decode once, zero-copy. True
  memory-mapping is not reachable from React Native JS and is not needed at these sizes (§5). Failure →
  E-1.5 "lexicon index missing/corrupt" state; never partial play.
- **Server (`services/game`):** read once per (`lexiconVersion`, profile) into a process-wide immutable cache
  shared by all matches; sha256 verified with `node:crypto` against the registry. `readFileSync` can return a
  pooled, unaligned `Buffer` for small files — the decoder copies once if `byteOffset % 4 !== 0`.
- **Engine tests / bots simulator:** decode from the build output, or use the reference implementation (§7, T4).

### 3.6 Cards artefact (not part of the engine interface)
Definitions EN/FR, `display`, `owner`, `sources` per term id, as gzip JSON next to the `.clxi`, loaded lazily for
Knowledge Cards (E-1.5 AC-13). Estimated ≈ 250 B/term raw (two ≤ 160-char definitions + display): ≈ 0.5 MB raw for
2,000 terms (estimate). At 50,000 terms (≈ 12 MB raw, estimate) cards come from `services/knowledge`, not the bundle.

## 4. Determinism and versioning

### 4.1 `lexiconVersion` — consistent with `validate.mjs`
The build never computes its own version: it uses `loadLexicon().version`, i.e. exactly what
`pnpm lexicon:validate` prints. Today that is the first 16 hex chars of sha256 over `(relative path, NUL, raw
bytes)` of `data/terms/*.json` in sorted order. Three gaps found while writing this note:

1. **Path separator:** `relative()` yields `\` on Windows, so the same data hashes differently on Windows.
2. **Line endings:** raw bytes are hashed and the repo has no `.gitattributes`; a CRLF checkout changes the version.
3. **Coverage:** `categories.json`, `blocklist/*.txt` and (future) `profiles/*.json` are not hashed. Today a
   blocklist-only change cannot silently change the playable set, because the validator fails when a playable
   form is blocklisted — so the gap is latent, not live — but profiles will change the playable set.

Proposal (task T1, its own PR, test-first, `LEXICON_SPEC.md` §6 updated in the same PR): define
`lexiconVersion` as sha256 (first 16 hex) over a **canonical serialisation** — RFC 8785 JSON canonicalisation of
`{ schemaVersion, categories, terms sorted by id, blocklist sorted }` — independent of file layout, whitespace,
OS and line endings. This is also required for `services/knowledge`, which publishes from database rows, not
files, and must reproduce the same version for the same content. No version has been published or pinned yet, so
changing the formula now costs nothing; after the first published version it would be a contract change.
*Decided 2026-10-02 (ADR-0013 §D7):* the canonical document covers the playable content only (everything the
index or the engine can observe); display-only content (definitions, `display`, `owner`, `sources`, category
names) is excluded and versioned by the cards artefact's own content hash. Exact field list: task L1 — done,
see `docs/game/LEXICON_SPEC.md` §7 (`lexiconVersion` and `cardsVersion`, `scripts/canonical.mjs`).

### 4.2 Profiles
- Definitions live in `packages/lexicon/data/profiles/<id>.json` (global, season) or in `services/knowledge`
  (org). A profile is a deterministic set expression (`include` ∪ … minus `exclude`) over ids, tags (e.g.
  `season:s01-the-cloud`, already used in the data), categories; only `playable: true` terms are eligible.
- `definitionHash` = sha256 (first 16 hex) of the canonical profile definition; it is in the artefact header,
  so the artefact identity is (`lexiconVersion`, profile id, `definitionHash`). Profile content decisions (what a
  season pack contains) belong to `lexicon-curator` + `game-designer`, not to this note.

### 4.3 Build determinism (same input ⇒ same bytes)
Inputs sorted (forms by UTF-16 code unit, ids, categories, edges); automaton minimisation assigns node ids in a
fixed traversal order (post-order, arcs ascending); no `Map`/`Set` iteration order leaks into output without an
explicit sort; fixed endianness, zero padding, no timestamps. Verified by tests (§7) and by CI building on Linux
and macOS runners and comparing sha256.

### 4.4 Pinning, replays, blocklist
- Matches pin `lexiconVersion` + profile at creation (R-CORE-001); the engine rejects a mismatched index (§2.2).
  Replays carry the same pair plus `engineRulesVersion` (E-1.5 AC-20; log format in ADR-0013).
- Published artefacts are immutable and retained as long as any replay references them. The decoder keeps
  support for every `formatVersion` ever published; to retire a format, old versions are rebuilt from source
  (deterministic build + registry `lexiconVersion → git commit`) and a test proves semantic equivalence
  (same forms, same metadata, same adjacency) before the old format is dropped.
- Blocklist is applied at build in two layers: the validator rejects a blocklisted playable form (build fails,
  nothing silently disappears), and the encoder asserts that no blocklisted form reaches any section. Removing a
  form after publication = new `lexiconVersion` + flag rollout (ARCHITECTURE §3.4); live matches finish on their
  pinned version, so an emergency removal must also go through the integrity/liveops kill-switch process
  (open question Q-H2).

## 5. Budgets (all values estimates unless marked measured)

Basis: prototype minimiser on today's seed — **measured** 310 forms / 2,007 letters → DAWG 650 nodes, 944 edges;
GADDAG 3,925 nodes, 5,645 edges. Larger rows extrapolate nodes-per-letter linearly (DAWG 0.32, GADDAG 1.96),
which is an **upper bound**: suffix/prefix sharing improves with size (Gordon 1994 reports a GADDAG roughly five
times the size of the DAWG for the same lexicon; our small set shows ≈ 6×). Assumed average form length: 6.5
(2,000) and 7 (50,000). Bytes use the v1 layout in §3.3.

| Metric | 300 forms (today) | 2,000 forms (E-1.5 R-1) | 50,000 forms (maturity) | Budget |
|---|---|---|---|---|
| DAWG section | ≈ 13 KB (counts measured, bytes estimated) | ≤ 85 KB | ≤ 2.2 MB | — |
| GADDAG section | ≈ 54 KB (counts measured, bytes estimated) | ≤ 350 KB | ≤ 9.4 MB upper bound; planning 3–5 MB | optional on mobile at 50k |
| TERMS + STRINGS + ADJ + LETTERS | ≈ 15 KB | ≈ 100 KB | ≈ 3 MB (assumes ≈ 3 edges/term) | — |
| `.clxi` total, uncompressed | ≈ 80 KB | ≤ 0.55 MB | 6–15 MB | — |
| Compressed in app bundle / CDN (≈ 50 %, estimate) | ≈ 40 KB | ≤ 0.3 MB | 3–7 MB | ≤ 5 MB (E-1.5 assumption) |
| JS heap after load (zero-copy views) | ≈ file size + < 0.1 MB | ≈ 0.6 MB | ≈ file size | — |
| Load on low-end Android (read + sha256 + views) | < 50 ms | < 100 ms | 150–400 ms | ≤ 500 ms (E-1.5 assumption) |
| `has()` server (Node/V8 JIT) | 0.05–0.3 µs | 0.05–0.3 µs | 0.05–0.3 µs (bounded by length ≤ 15, not size) | < 5 µs (ARCHITECTURE §5) |
| `has()` device (Hermes interpreter) | 1–5 µs | 1–5 µs | 1–5 µs | ≤ 20 µs p99 (approved 2026-10-02) |
| Full move generation, one rack, mid-game 15×15 (V8 / Hermes) | < 1 ms / < 20 ms | < 5 ms / < 100 ms | 10–50 ms / 0.2–1 s | Strategist compute p95 ≤ 2 s on device (E-1.5 AC-8) |
| Build time (Node, CI) | < 0.5 s | < 1 s | < 10 s | — |

Reading the table: lookup cost depends on form length, not lexicon size, so the 5 µs NFR holds at any scale on
the server; the binding constraints are **artefact size at 50,000 forms** on mobile (mitigations: omit the GADDAG
section on mobile and let bots fall back to DAWG-based generation, roughly 2× slower but ≈ 5× smaller, or deliver
by CDN instead of the bundle) and **Hermes lookup speed** (fallback: back `has`/`lookup` with a `Map<string,
FormRef>` built at load — ≈ 60–100 B/form heap, estimate — without changing the interface).

How it is measured (task T8):
- `vitest bench` in `packages/lexicon/bench/`: `has`/`lookupCodes` ns/op over all forms (hits) and 10,000
  seeded non-forms (misses), `crossCheck`, `decodeLexiconIndex`, build time. Results exported as JSON CI
  artefacts and trended. Hard gate at 2× budget (CI runners are noisy); breaches below that are reported, not
  blocking.
- **Size gate** (exact, deterministic, hard): artefact bytes per profile against the budget column; size diff
  printed on every lexicon PR.
- **Scale fixtures:** seeded synthetic corpora of 2,000 and 50,000 forms (letter-bigram model fitted on the real
  forms), clearly labelled synthetic — they validate scaling trends, not real sharing ratios.
- **Device:** Hermes timings on the E-1.5 reference device as part of the AC-8 perf test (`mobile-engineer`);
  optionally the Hermes CLI in CI as a proxy (Q-H1). Move-generation benchmarks with fixed seeded positions live
  in `packages/bots` (`ai-engineer`).

## 6. Alternatives considered

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Plain `Set<string>` / `Map` built from JSON | trivial, fastest JIT lookup, fine at 300–2,000 forms | no prefix structure ⇒ bots must brute-force; JSON parse cost and heap grow with size; metadata as JS objects | **Reference implementation and test oracle** (T4), possible `has` backing on Hermes; not the shipped format |
| Trie (unminimised) | prefix queries | 2–4× the nodes of a DAWG (measured 1,462 vs 650 today) | rejected |
| DAWG only | small, O(len) lookup, rank ⇒ perfect hash for `TermRef`, supports cross-checks and Appel–Jacobson generation | move generation must restart from prefixes left of the anchor | **kept** as the membership/metadata structure |
| GADDAG | move generation from any anchor in both directions; ≈ 2× faster generation (Gordon 1994) | ≈ 5–6× DAWG size | **kept as an optional section** for bots |
| JSON artefact | readable, no decoder | parse time and heap on low-end Android, larger, number-only typed data is wasteful | rejected for the index; used for cards and manifest |
| Binary with typed-array views | zero-copy load, compact, deterministic bytes | needs a versioned decoder and fuzz tests | **recommended** |

**Recommendation:** one binary `.clxi` per (`lexiconVersion`, profile) containing DAWG + metadata + adjacency
always, GADDAG section included by default (always on the server, on mobile while the size gate holds), decoded
once into typed-array views; a `Set`-backed reference implementation as test oracle.

**ADR?** Not for the format: it sits behind `LexiconIndex`, carries its own `formatVersion`, and can be replaced by
rebuilding from source — a two-way door, consistent with ADR-0006 (which already names the in-memory GADDAG for
game-time lookups). What is contract-level is the **definition of `lexiconVersion`** (T1) and the **profile
identity** in match state; both are recorded in `docs/game/LEXICON_SPEC.md` (the schema is the contract), not an
ADR. An ADR becomes necessary if we decide to download lexicons over the air to mobile clients (CDN delivery,
signing, rollback of on-device versions) — expected in Phase 2.

## 7. Test plan

Strict coverage preset (90 %, config note §2) for `packages/lexicon/src/index` because it is on the rules path
(R-TURN-003), above the 80 % default for packages. Properties use fast-check with recorded seeds.

| ID | Property / test | Kind |
|---|---|---|
| T-COMPLETE | ∀ form in the resolved profile: `has(form)`, and `meta(termOf(lookup(form)))` equals the source (canonical) term (id, difficulty, categories, gameValue/knowledgeXp from `formulas.mjs` or override) | property, real data + fixtures |
| T-SOUND | ∀ string not in the profile set: `!has(s)` — generators: random A–Z 1..16, edits of real forms (insert, delete, substitute, transpose), every proper prefix/suffix, concatenations of two forms | property |
| T-INPUT | `has` is false and never throws for `''`, 1 letter, 16+ letters, lowercase, digits, `É`, Turkish `İ`, surrogate pairs | unit |
| T-GADDAG | the language of the GADDAG (all accepted paths, un-reversed) equals the DAWG language; every (form, split) path exists; `crossCheck(before, after)` equals brute force over the form set | property |
| T-REL | `related` symmetric and irreflexive; every data edge with both ends in the profile is present with its type; no neighbour outside the profile | property |
| T-DETERMINISM | building twice ⇒ identical bytes; shuffled file order, `\` paths and CRLF ⇒ identical bytes (after T1); golden sha256 for the fixture lexicon committed; Linux vs macOS CI comparison | unit + CI |
| T-ROUNDTRIP | `decode(encode(model))` equals `model`; `encode(model(decode(bytes)))` equals `bytes` | property |
| T-BLOCKLIST | fixture with a blocklisted playable form ⇒ `Err(BLOCKLISTED_FORM)`; no artefact section contains a blocklisted form | unit |
| T-PROFILE | resolved set equals the set expression evaluated by the reference implementation on fixture tags/categories/ids; empty profile ⇒ `Err(EMPTY_PROFILE)` | property |
| T-CORRUPT | truncation, bit flips, wrong magic, unknown format ⇒ typed `Err`, never a throw, never a wrong answer | fuzz |
| T-VERSION | header version equals `loadLexicon().version`; mismatched `expect` ⇒ `Err(VERSION_MISMATCH / PROFILE_MISMATCH)` | unit |
| T-ORACLE | for every query in the above suites, binary index and `Set`-backed reference give identical answers | differential |

Per the role rules, each validator invariant touched by T1 (canonical hash, profile files) gets fixtures that must
fail.

## 8. Task breakdown (E-1.2)

| ID | Task | Owner | Reviewers | Depends on | Size |
|---|---|---|---|---|---|
| T0 | Review this note; settle Q-G*, Q-A* | lexicon-engineer | game-engine-engineer, ai-engineer | — | S |
| T1 | Canonical `lexiconVersion`, `data/profiles/*.json` + schema + validator rules, `.gitattributes` (`eol=lf` for data), `LEXICON_SPEC.md` §6 update | lexicon-engineer | lexicon-curator, game-designer (profile semantics) | T0 | S |
| T2 | TypeScript in `packages/lexicon` (`src/`, tsconfig, strict Vitest preset, ESLint) keeping `validate.mjs` zero-dependency — done (sprint L2) | lexicon-engineer | devops-sre | sprint S2, S5 | S |
| T3 | Types: `LexiconIndex`, `Gaddag`, errors (this note §2) — done (sprint L2) | lexicon-engineer | game-engine-engineer, ai-engineer | T2 | S |
| T4 | `Set`/`Map` reference implementation (test oracle; unblocks E-1.1 immediately) | lexicon-engineer | game-engine-engineer | T3 | S |
| T5 | DAWG build + minimisation + rank, encoder/decoder v1, CRC32 | lexicon-engineer | code-reviewer | T3 | M |
| T6 | GADDAG build + traversal + `crossCheck` | lexicon-engineer | ai-engineer | T5 | M |
| T7 | Property/differential/fuzz tests, golden fixtures | lexicon-engineer | qa-engineer | T4–T6 | M |
| T8 | Benchmarks, size gate, synthetic scale corpora, CI wiring | lexicon-engineer | devops-sre | T5–T6 | S |
| T9 | `build:index` CLI, Turborepo task, manifest | lexicon-engineer | devops-sre | T5 | S |
| T10 | Mobile asset bundling + loader + corrupt-index state (E-1.5) | mobile-engineer | lexicon-engineer | T9 | S |
| T11 | Server loader cache in `services/game` (Phase 2) | game-engine-engineer | lexicon-engineer | T9 | S |
| T12 | `services/knowledge` publish path, immutable storage, version registry (Phase 2+) | lexicon-engineer | devops-sre, security-engineer | T9 | M |

## 9. Open questions

Q-G1–Q-G4, Q-A1 and Q-H3 were decided on 2026-10-02 in `docs/adr/0013-determinism-replay-contract.md`
("Resolved questions"); the original questions are kept below each resolution.

- **Q-G1 — RESOLVED 2026-10-02 (ADR-0013):** accepted. The engine receives the index as `ctx.lexicon`;
  `createMatch`, `apply` and `replay` compare (`version`, `profile.id`, `profile.definitionHash`) with the match
  state and return a typed `LEXICON_MISMATCH` engine error (not a player rejection; state unchanged). Original
  question:
  **Q-G1 (game-engine-engineer)** Accept injection via `ctx.lexicon` and the `LEXICON_MISMATCH` check in `apply`?
- **Q-G2 — RESOLVED 2026-10-02 (ADR-0013):** `lookupCodes(codes, from, to)` is the contract; no cursor API unless
  profiling shows word extraction > 20 % of `apply` time. Original question:
  **Q-G2 (game-engine-engineer)** Is `lookupCodes(codes, from, to)` the right shape for reading words off the
  board, or do you prefer a reusable cursor?
- **Q-G3 — RESOLVED 2026-10-02 (ADR-0013):** both assumptions confirmed. Relations are undirected (R-SCORE-005 a);
  adjacency only contains in-profile terms, so nothing links through an out-of-profile term. Chains resolve on
  canonical terms: an inflection and its canonical term are the same term, hence not a link. The match state
  stores the previous main word as its form, never a `TermRef`. Original question:
  **Q-G3 (game-engine-engineer, game-designer)** R-SCORE-005: confirm relations are **undirected** for the chain
  bonus, and that a link through a non-playable or out-of-profile term does not count (this note assumes both).
- **Q-G4 — RESOLVED 2026-10-02 (ADR-0013, also closes A-01 of RULE_PROPERTIES):** letter values and bag are
  frozen per `engineRulesVersion` (table for version 1: sprint task D3, `game-designer`). The R-BAG-001 derivation
  runs offline on raw `letterCounts()` (no "term frequency class" exists; any weighting is a game-designer choice
  inside that tooling); the index build does **not** embed a bag; lexicon releases never change scoring. Original
  question:
  **Q-G4 (game-engine-engineer, game-designer)** BALANCE.md R-BAG-001 weights letter frequency "by term frequency
  class", which does not exist in the schema. Raw `letterCounts` only for now? Is the derived bag frozen by the
  engine version (replays pin it, AC-20) or should the build embed it?
- **Q-A1 — RESOLVED 2026-10-02 (ADR-0013):** node-final GADDAG + `crossCheck` is enough for Phase 1; format v1
  has no arc-final letter sets or length bounds. Trigger for an optional section (new `formatVersion`): bot
  compute p95 on the reference device > 50 % of the 2 s budget (E-1.5 AC-8). Original question:
  **Q-A1 (ai-engineer)** Is node-final GADDAG + `crossCheck` enough, or do you need per-node "letter sets"
  (Gordon's arc-final variant) or a precomputed per-node remaining-length bound for pruning?
- **Q-A2 (ai-engineer)** On mobile at large scale, is DAWG-only generation acceptable for Strategist within the
  2 s budget if the GADDAG section has to be dropped?
- **Q-H1 — RESOLVED 2026-10-02:** product owner approved 5 µs as the server (Node) budget and ≤ 20 µs p99 on
  the reference device. Original question:
  **Q-H1 (human / solution-architect)** The 5 µs NFR is assumed to be a **server** (Node) budget; proposed device
  budget ≤ 20 µs p99 on the reference device. Approve, and approve using a Hermes CLI proxy in CI?
- **Q-H2 — RESOLVED 2026-10-02:** new `lexiconVersion` + flag; live matches finish on their pinned version (see
  LEXICON_SPEC §6). Original question:
  **Q-H2 (human / monetization-liveops / security-engineer)** Emergency removal of an offensive form from live
  matches pinned to an old version: is "new version + flag, live matches finish on the old one" acceptable, or do
  we need a runtime deny-list overlay (which would break strict determinism of replays unless versioned too)?
- **Q-H3 — RESOLVED 2026-10-02 (ADR-0013, delegated by the product owner):** `global-ranked` contains every
  playable term; `season:*` tags are thematic and never remove a term. A season pack is a superset
  (`global-ranked` ∪ pack terms), never "season tag only". Pack-exclusive terms use a `pack:<id>` tag and are
  excluded from `global-ranked` by its profile definition; org profiles may be subsets. Original question:
  **Q-H3 (lexicon-curator, game-designer)** Profile semantics: does `global-ranked` include season-tagged terms,
  and is a season pack "global ∪ season tag" or "season tag only"?
- **Q-L13 — RESOLVED 2026-10-02 (sprint L2, lexicon-engineer; game-engine API note §20 question 13):** the
  names are confirmed as proposed, with no semantic change to the API note §5: `lookup(form)` and
  `lookupCodes(codes, from, to)` return `FormRef | undefined`; `termOf(form: FormRef): TermRef` resolves a played
  form (canonical or inflection) to its canonical term; `meta(term: TermRef).form` is always the **canonical** form
  (`meta(termOf(lookup('PODS'))).form === 'POD'`, `.id === 'pod'`); identity is `version` (the `lexiconVersion`)
  and `profile` (`id`, `kind`, `definitionHash`). Additions beyond the `EngineLexicon` subset: `formMeta(FormRef)`
  (`{ ref, form, term, kind }`, for "Played as PODS" and summary chips) and `termCount` (`size` counts forms).
  Original question: **(game-engine-engineer → lexicon-engineer)** Confirm the member names
  `termOf(FormRef): TermRef`, `lookup`/`lookupCodes` returning `FormRef`, and that `meta(TermRef).form` is the
  canonical form.
