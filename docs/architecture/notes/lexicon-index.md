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
/** Read-only per-letter counts (index = LetterCode): a fresh copy per call or a frozen array (L2 review). */
export type LetterCounts = ArrayLike<number> & Iterable<number>;
/** 16 hex; hash of the canonical profile definition (§4.2). Distinct brand from LexiconVersion. */
export type DefinitionHash = string & { readonly __brand: 'DefinitionHash' };

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
  readonly definitionHash: DefinitionHash;
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
  /** occurrences of each letter across all forms of the profile; index = LetterCode. No mutators in the type;
   *  implementations return a fresh copy or a frozen array, so callers can never alter the index. */
  letterCounts(): LetterCounts;

  // --- move generation (packages/bots) ---
  readonly gaddag: Gaddag | undefined;                // undefined if the artefact omits the section (flags bit 0)
  readonly dawg: Dawg;                                // always present (sprint L5, bots-api O-1)
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

/** Pure; never throws on bad input; zero-copy views over `bytes` when `bytes.byteOffset % 8 === 0`, else one
 *  copy. Zero-copy views share memory with `bytes`: the caller (loader) owns the buffer and must keep it
 *  immutable for the lifetime of the index — validation runs once, at decode time. */
export type DecodeLexiconIndex = (
  bytes: Uint8Array,
  expect?: LexiconIndexExpectation,
) => Result<LexiconIndex, LexiconIndexError>;
export const decodeLexiconIndex: DecodeLexiconIndex;
```

Runtime values exported next to the types (sprint L2): `DIFFICULTIES`, `RELATION_TYPES` (index k = bit k of a
`RelationMask`, append-only), `INFLECTION_KINDS`, `FORM_KINDS`, `LETTER_COUNT`, `GADDAG_SEPARATOR`,
`MAX_FORM_LENGTH` (a unit test keeps the enums equal to `schema/term.schema.json`; tuple types via `satisfies`),
`isLexiconVersion`, `isDefinitionHash`,
`relationBit` (throws `RangeError` on a type outside `RELATION_TYPES`, so the L4 build fails loudly instead of
producing the sign bit) / `hasRelation` (false for an unknown type) / `relationTypesOf`, `CLXI_MAGIC`, `SUPPORTED_FORMAT_VERSIONS`. Until L4 ships
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

*Implemented 2026-10-03 (sprint L5, T6):* the GADDAG language is **exactly** those paths (Σ |w| paths, nothing
else), which the decoder proves at load (§3.3). The same sprint adds the DAWG accessor requested by
`docs/architecture/notes/bots-api.md` §4.3 (O-1), for DAWG (Appel–Jacobson) generation when `gaddag` is undefined:

```ts
export type DawgNode = number & { readonly __brand: 'DawgNode' };
export interface Dawg {                               // the Gaddag shape without the separator
  readonly root: DawgNode;
  arcs(node: DawgNode): LetterMask;                   // bits 0..25, iterate ascending
  next(node: DawgNode, letter: LetterCode): DawgNode | -1;
  isFinal(node: DawgNode): boolean;                   // the letters read spell a playable form
}
```

Its language is exactly the playable forms (canonical and inflections); enumerating it with arcs ascending yields
them in `FormRef` order. In both automata and both implementations, a node that is not one of the automaton's
own (negative, fractional, out of range) is a dead end — `arcs` 0, `next` −1, `isFinal` false — never a throw,
and a symbol outside the alphabet gives −1. The reference index (§7, T4) serves both as plain unminimised tries
built on first access (`createReferenceIndex({ …, gaddag: false })` mimics an artefact without the section), so
the minimal automata of the binary index are checked against an independent construction.

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
  → DAWG (minimised, rank-annotated)  +  GADDAG (minimised, optional section, flags bit 0)
  → encode binary v1 (§3.3)
  → self-check: decode the bytes with expect {version, profileId}; failure ⇒ VALIDATION_FAILED, nothing written
  → <profile>.f<flags>.clxi  +  manifest.json entry (flags, gaddag, sha256, sizes, formatVersion)
```

### 3.2 Build API

```ts
export interface LexiconProfileDefinition {
  readonly id: string;
  readonly kind: LexiconProfileKind;
  readonly include: { readonly all?: true; readonly tags?: readonly string[];
                      readonly categories?: readonly string[]; readonly ids?: readonly string[] };
  readonly exclude?: { readonly tags?: readonly string[]; readonly ids?: readonly string[] };
  readonly inflections?: 'all' | 'none';  // E-1.7 D-14, default 'all' (§4.2; added sprint 3 P8)
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

*Implemented (sprints L4, L5):* the normative layout is `packages/lexicon/src/index/clxi/format.ts`; the table below
is the original design, kept for its rationale. As built, format 1 has a 56-byte header and a **fixed table of 15
sections** — `META` (9 × u32, including the DAWG and GADDAG node/edge counts), `STRINGS`, `CATEGORIES`, `TERMS`,
`TERM_FORM`, `FORM_TERM`, `FORM_KIND`, `ADJ_START`, `ADJ`, `ADJ_MASK`, `LETTERS`, `DAWG_NODES`, `DAWG_EDGES`,
`GADDAG_NODES`, `GADDAG_EDGES` — each starting at the first 8-byte boundary after the previous one.

- **Flags (header u16 at offset 6):** bit 0 = GADDAG present. Bit 0 clear ⇒ both GADDAG sections are empty
  (length 0) and their META counts are 0; bit 0 set ⇒ a non-empty GADDAG is required; any disagreement is
  `CORRUPT` (`gaddag counts`). Any other bit set ⇒ `UNSUPPORTED_FORMAT` (checked after the CRC, so a flipped bit
  in a damaged file is still `CORRUPT`). The two variants of one (`lexiconVersion`, profile, `definitionHash`)
  differ only in the header flags, META counts, the GADDAG sections and the CRC; every other section is
  byte-identical (tested).
- **GADDAG sections:** nodes u32 × 2 (arc mask bits 0..26, bit 26 = ◇, | final << 31; first edge), edges u32
  (target). Both automata are minimal, numbered root 0 then breadth-first with arcs ascending, with node k's edges
  starting where node k−1's end.
- **Decoder checks behind the CRC** (T-CORRUPT, both automata): only known arc/final bits, contiguous edges,
  targets in range, breadth-first numbering (so every node is reachable), acyclic with ≤ 16-symbol paths, trim
  (every node reaches a final node), minimal (no two nodes with the same final bit, arcs and targets): one
  language ⇒ one byte string. GADDAG language: every `rev(w[0..i]) [◇ w[i..n]]` path of every enumerated form
  reaches a final node, and the automaton accepts exactly Σ |w| paths (post-order path count, saturating), so it
  accepts nothing else. Cost O(nodes + edges + Σ |w|²) at load.
- **Format 1 freeze** (made explicit in sprint 3, task P4; lexicon-engineer with the solution-architect review).
  Replays identify an index by (`lexiconVersion`, profile id, `definitionHash`) only (ADR-0013 §D7): the GADDAG
  is derived from the forms, so both flag variants give the same answers to every engine and bot query.
  - **Trigger.** Format 1 freezes at the **first** of these two events, whichever comes first:
    1. **the first build installed outside CI** — any app or server build that contains or loads a `.clxi` and
       runs anywhere other than a CI job (EAS internal distribution, TestFlight, Play internal track, a sideloaded
       APK, a staging server, a playtest device). Local `expo start` / simulator runs on a developer machine do
       not count;
    2. **the first exported log** — the first action log or replay played against a `.clxi` artefact that
       leaves the app or server that produced it (E-1.5 AC-20 "Send match log", a bug-report attachment, an
       upload). Simulator readouts (aggregate KPIs) and engine goldens in the repo (e.g.
       `replays/v1/gc-det-01`) do not count: readouts carry no action log, and goldens pin a JSON fixture lexicon.

    Rationale: after either event, bytes or log references exist that the repo no longer controls, and §4.4
    requires the decoder to keep reading them. Until then format 1 can still change freely, because every
    artefact is rebuilt from source.
  - **Effect.** After the freeze, any change to the header, the section table, a section layout, a flag meaning
    or a decoder acceptance rule that would make a frozen artefact decode differently is **format 2** (new
    `formatVersion`; the decoder keeps format 1, §4.4). Not layout changes, and so allowed under format 1:
    new profiles and new profile options (they live in `definitionHash`, §4.2, e.g. `inflections`), new
    lexicon content (new `lexiconVersion`), and builder fixes that keep the bytes of existing inputs.
  - **Reserved bits stay reserved.** Header flag bits 1–15 decode as `UNSUPPORTED_FORMAT` (checked after the
    CRC). A frozen format 1 never gives them a meaning: a new optional section (ADR-0013 Q-A1) or any other
    flag is format 2. Likewise, `formatVersion` values other than 1 are `UNSUPPORTED_FORMAT` until a decoder for
    them ships.
  - **Pre-freeze checklist** (done 2026-10-05, sprint 3 P4):
    - [x] Reserved flag bits → `UNSUPPORTED_FORMAT`, after the CRC
      (`clxi.test.ts` "UNSUPPORTED_FORMAT: flags 0x…"); unknown `formatVersion` → `UNSUPPORTED_FORMAT`
      (`decode.test.ts`); builder refuses any `formatVersion` but 1 (`LIMIT_EXCEEDED`).
    - [x] Golden pin of the fixture artefact, both flag variants (CRC-32 and size, `clxi.test.ts` "golden pin").
    - [x] Both flag variants differ only in the header flags, META counts, GADDAG sections and CRC (tested).
    - [x] Header identity complete: canonical `lexiconVersion` (L1, §4.1) and a `definitionHash` that covers every
      profile option, including `inflections` (P8). No profile option needs a header field.
    - [x] Decoder checks behind the CRC (T-CORRUPT, above) and unaligned input (§3.5).
    - [x] Format limits checked against the playtest lexicon: ≤ 32 categories (9 used), u16 values, forms of
      2–15 letters; the restated size gate and its f0 switch rule (§5.1, P7).
    - [x] Known reasons for format 2 recorded: optional bot sections (ADR-0013 Q-A1 trigger).
    - Not a freeze prerequisite: the Linux vs macOS build comparison (T-DETERMINISM) tests the builder, not the
      layout; a builder bug found later is fixed in the builder, with format 1 unchanged.
  - **At the trigger** (the PR or release that causes it): add a dated "Frozen on <date> by <event>" line here,
    and move the fixture golden pin into a file protected by `tools/golden/protected-paths.json` (P3), so that
    golden-immutability fails any later edit.
  - **ADR check (solution-architect view, P4):** no ADR change. ADR-0013 §D7 already fixes the artefact identity
    used by logs, and §4.4 here already fixes decoder retention. The freeze is a lexicon-internal commitment
    whose reversal costs one `formatVersion` bump, not a change to the replay contract. ADR-0014 only refers to
    the freeze as a deadline.
  - **Status:** not frozen (2026-10-05): no trigger event is recorded in the repo. Whoever ships the first
    out-of-CI build or the first log export owns the "At the trigger" step above.

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
- **Phase 1 (T9, done in sprint L6):** `pnpm turbo run build:index` (Turborepo task `@codelex/lexicon#build:index`,
  defined in `packages/lexicon/turbo.json`) writes, under `packages/lexicon/dist/indexes/`:
  - `<lexiconVersion>/<profileId>.f<flags>.clxi` — `f1` with the GADDAG (server, default), `f0` without it —
    for every profile of `BUILT_PROFILES` (`scripts/canonical.mjs`): `global-ranked` and, since sprint 3 P8, the
    simulation-only `global-no-inflections` (§4.2; never bundled: apps pick `global-ranked` explicitly);
  - `<lexiconVersion>/manifest.json` — `{ lexiconVersion, profiles: [{ id, kind, definitionHash, formatVersion,
    flags, gaddag, file, bytes, sha256 }] }`, one entry per (profile, flags), canonical JSON;
  - `current.json` — `{ lexiconVersion, manifest: "<lexiconVersion>/manifest.json" }`, the stable entry point for
    consumers that cannot know the version in advance.

  The directory holds exactly one version: the build empties it after every artefact passed its self-check and
  before writing. Git-ignored; artefacts are reproducible so they are never committed.
  - **Cache inputs:** `data/**`, `schema/**`, the scripts it runs (`build-index`, `validate`, `canonical`,
    `formulas`), `package.json`, and through `dependsOn: ["build"]` the builder source (`build` inputs:
    `src/**` minus tests, `package.json`, `tsconfig*.json`). Tests, README and other docs do not invalidate it.
    **Outputs:** `dist/indexes/**`, so a cache hit restores the artefacts, the manifest and `current.json`;
    `build` excludes `dist/indexes/**` and `dist/bench/**` from its own outputs so it never restores stale ones.
  - **Consumers:** `@codelex/lexicon/indexes` (`scripts/indexes.mjs`, zero-dependency) —
    `resolveIndexArtefact({ profileId, flags })` follows `current.json`, finds the manifest entry and refuses
    (typed `IndexArtefactError`: `INDEX_NOT_BUILT`, `INDEX_MANIFEST_INVALID`, `INDEX_PROFILE_MISSING`,
    `INDEX_SHA_MISMATCH`) unless the file's size and sha256 match; it returns `{ lexiconVersion, path, entry,
    bytes }`. `readIndexManifest()` returns every entry. A consumer's task depends on
    `@codelex/lexicon#build:index`. `apps/mobile` (`prepare:lexicon`, mobile-app-foundation note §3.1) copies
    the bundled profile variant — chosen explicitly with `flags`, `f1` while the size gate holds (§5) — and its
    manifest entry into its assets at build time.
  - **Proof in CI:** the lexicon `test` task depends on `build:index` and `test/build-index.test.mjs` checks that
    very output (one build per run): version equals the current data, one version directory, every file decodes
    with its version and profile, GADDAG presence matches `flags`, size and sha256 match the manifest.
- **Later (ARCHITECTURE §3.4):** `services/knowledge` publish runs the **same builder** (imports
  `@codelex/lexicon`) on the approved draft, uploads to object storage under an immutable key
  `lexicon/<lexiconVersion>/<profileId>/<definitionHash>.v<formatVersion>.f<flags>.clxi` (the flags are part of
  the key: both variants share version, profile and hash but not their bytes), and registers it. Org-restricted
  profiles (B2B/EDU) are built only there, because org definitions are tenant data and never live in the repo.

### 3.5 Loading
- **Mobile (Hermes):** the `.clxi` is a bundled asset (Metro `assetExts` += `clxi`); read once into an
  `ArrayBuffer`, verify its sha256 against the bundled manifest with the platform digest (native, e.g. expo-crypto),
  then `decodeLexiconIndex` creates typed-array **views** over that buffer — decode once, zero-copy. True
  memory-mapping is not reachable from React Native JS and is not needed at these sizes (§5). Failure →
  E-1.5 "lexicon index missing/corrupt" state; never partial play.
- **Server (`services/game`):** read once per (`lexiconVersion`, profile) into a process-wide immutable cache
  shared by all matches; sha256 verified with `node:crypto` against the registry. `readFileSync` can return a
  pooled, unaligned `Buffer` for small files — the decoder makes one real copy if `byteOffset % 8 !== 0` (a
  `Buffer#slice` would be a view, R1 review M1).
- **Ownership (all loaders):** the bytes handed to `decodeLexiconIndex` belong to the loader and must stay
  immutable after decoding. Aligned input is not copied, so the index reads that very memory; the decoder
  validated it once and does not re-check on queries. Never reuse or write to that buffer while the index lives.
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
- **Option `inflections: all | none`** (E-1.7 D-14, sprint 3 P8). Build-time only: `none` builds canonical forms
  only, with the same terms, metadata and relations; `all` is the default and is omitted from the canonical
  definition, so `global-ranked` (which predates the option) keeps its `definitionHash` (`da1f36a3747e0dfe`) and
  its artefact bytes. Unknown values are refused (`TypeError` in `canonical.mjs`, `VALIDATION_FAILED` in the
  builder). `profileBuildInput(definition)` derives the builder's profile reference and the hash from one
  definition, so the option applied is always the one hashed. `global-no-inflections` (`00d1ebcc16bb3489`) is
  the AC-20 "without inflections" variant: `build:index` builds it, and the simulator builds it with the same
  builder call, instead of stripping inflections itself. Tests: `test/canonical.test.mjs` (pinned hashes, refused
  values), `src/index/clxi/clxi.test.ts` (`all` ≡ absent bytes, `none` ≡ stripped document, both lists of option
  values equal) and `test/build-index.test.mjs`. For `lexiconVersion` `e568477b5592a994` that last test pins the
  sha256 of all four artefacts to the values built by the pre-P8 code. For any lexiconVersion, it also checks
  that the option paths give the same bytes as the option-less builder calls.

### 4.3 Build determinism (same input ⇒ same bytes)
Inputs sorted (forms by UTF-16 code unit, ids, categories, edges); automaton minimisation assigns node ids in a
fixed traversal order (breadth-first from the root, arcs ascending; root = node 0); no `Map`/`Set` iteration order leaks into output without an
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

*Measured 2026-10-03 (sprint L5, `lexiconVersion` ec9854cca6650c5c, 1,053 forms, 7,166 letters, Node 22, Linux
container):* DAWG 1,306 nodes / 1,963 edges = 26,152 B; GADDAG 8,476 nodes / 12,466 edges = 117,672 B (4.50× the
DAWG sections, gate ≤ 6×); artefact 184,688 B with the GADDAG (82,657 B gzip -9), 67,016 B without (26,395 B
gzip); decode with full validation 12.8 ms with the GADDAG, 3.8 ms without; build 47 ms / 11 ms; `has()` median 0.6–2.3
µs, `crossCheck()` median 0.7 µs alone (up to ≈ 7 µs while other suites run in parallel). Size gates (hard, in
`clxi.test.ts`): restated in sprint 3 for more than 2,000 forms, see §5.1 (the original "≤ 0.55 MB with the GADDAG
for ≤ 2,000 forms, ≤ 128 B per form without it, GADDAG sections ≤ 6× DAWG sections" is kept and extended). Speed
gates (node:test on `dist/`): `has()` < 10 µs, `crossCheck()` < 50 µs (median).

Reading the table: lookup cost depends on form length, not lexicon size, so the 5 µs NFR holds at any scale on
the server; the binding constraints are **artefact size at 50,000 forms** on mobile (mitigations: omit the GADDAG
section on mobile and let bots fall back to DAWG-based generation, roughly 2× slower but ≈ 5× smaller, or deliver
by CDN instead of the bundle) and **Hermes lookup speed** (fallback: back `has`/`lookup` with a `Map<string,
FormRef>` built at load — ≈ 60–100 B/form heap, estimate — without changing the interface).

How it is measured (task T8):
- **Done (sprint L6):** `pnpm turbo run bench:index --filter=@codelex/lexicon` (`scripts/bench-index.mjs`,
  uncached task after `build:index`) measures the built artefacts of both flags variants — bytes, forms,
  `decodeLexiconIndex` ms, `has` ns/op over all forms (hits) and form+`Q` (misses), `lookupCodes` ns/op, and
  `crossCheck` ns/op on `f1` — median of 5 batches, written to `dist/bench/index-bench.json`. CI runs it after the
  tests (non-gating step, a few seconds) and uploads it as the `lexicon-index-bench` artefact for trending. The
  hard gates stay in `test/index-speed.test.mjs` (`has` 10 µs = 2× budget, `crossCheck` 50 µs); breaches below
  that are reported, not blocking. *Measured* on `4fa5884050b4ea53` (1,501 forms, Node 22, dev container):
  `f1` 283,672 B, decode 17.7 ms, `has` 258/288 ns hit/miss, `crossCheck` 881 ns; `f0` 100,160 B, decode 4.6 ms.
- **Open:** build time in the JSON, 10,000 seeded non-forms instead of form+`Q`.
- **Size gate** (exact, deterministic, hard): §5.1, `scripts/size-gate.mjs`, applied in `clxi.test.ts`;
  `bench:index` reports each artefact's bytes, bytes per form and gate failures.
- **Scale fixtures — done (sprint 3, P7):** `scripts/scale-corpus.mjs`, seeded corpora fitted on the real lexicon
  (length distribution, start letter + letter bigrams, plural/verb and relation rates, difficulty and category mix),
  clearly labelled synthetic — they validate scaling trends, not real sharing ratios. `synthetic` = generated terms
  only; `real+synthetic` = every real term plus generated ones. `bench:index` builds both at 2,000, 2,500 and 3,000
  forms (`scale` in the JSON). The bots keep their own 2,000/50,000-form fixtures (`packages/bots`).
- **Device:** Hermes timings on the E-1.5 reference device as part of the AC-8 perf test (`mobile-engineer`);
  optionally the Hermes CLI in CI as a proxy (Q-H1). Move-generation benchmarks with fixed seeded positions live
  in `packages/bots` (`ai-engineer`).

### 5.1 Size gate above 2,000 forms (restated 2026-10-04, sprint 3 task P7)

**Why restate.** The first gate was "≤ 0.55 MB with the GADDAG for ≤ 2,000 forms": batch 3 (AC-14, ≥ 2,000
forms) leaves its scope, and a pure byte cap says nothing until it breaks. At 189 B/form a linear projection
puts the break near 2,900 forms. The measurements below put it at about 2,700.

**Measured growth** (2026-10-04, `pnpm turbo run bench:index`, builder of format 1 unchanged, Node 22; corpora from
`scripts/scale-corpus.mjs`; seed 1, and in brackets the range over seeds 1–4 for real+synthetic). B/form = artefact
bytes ÷ playable forms. GADDAG ÷ DAWG = section bytes.

| Corpus | Forms | f1 bytes | f1 B/form | GADDAG ÷ DAWG | f0 bytes | f0 B/form |
|---|---|---|---|---|---|---|
| real (`4fa5884050b4ea53`) | 1,501 | 283,672 | 189.0 | 4.71 | 100,160 | 66.7 |
| real+synthetic | 2,000 | 389,024 (389,024–395,968) | 194.5 (194.5–198.0) | 4.59 | 136,816 | 68.4 |
| real+synthetic | 2,500 | 498,520 (497,776–508,840) | 199.4 (199.1–203.5) | 4.52 | 174,024 | 69.6 |
| real+synthetic | 2,550 | 510,296 | 200.1 | 4.52 | 177,728 | 69.7 |
| real+synthetic | 3,000 | 600,920 (598,736–613,360) | 200.3 (199.6–204.5) | 4.52 | 209,296 | 69.8 |
| synthetic | 2,000 | 460,968 (460,968–480,544) | 230.5 (230.5–240.3) | 4.43 | 152,560 | 76.3 |
| synthetic | 2,500 | 563,864 (563,864–586,352) | 225.5 (225.5–234.5) | 4.43 | 188,768 | 75.5 |
| synthetic | 3,000 | 668,840 (666,464–699,232) | 222.9 (222.2–233.1) | 4.46 | 224,408 | 74.8 |

Earlier real points: 1,053 forms → 184,688 B (175.4 B/form, L5); 1,501 → 283,672 B (189.0). Reading:
- The real lexicon got denser per form from batch 1 to batch 2 (+8 %). This came from the content mix. Within one
  corpus the automata grow slightly super-linearly: real+synthetic goes from 194.5 to 200.3 B/form between 2,000
  and 3,000 forms, and the GADDAG stays at ≈ 4.5× the DAWG.
- Pure synthetic forms share fewer prefixes and suffixes than tech vocabulary (≈ 225 B/form). It is the
  pessimistic bound, not the projection.
- The 550,000 B cap is crossed at about **2,680–2,780 forms** on real+synthetic (4 seeds, interpolated) and at
  about 2,400–2,450 on pure synthetic. f0 stays below 80 B/form everywhere: about 7,000 forms before the cap.
- Build time: 150–260 ms (f1, real+synthetic, 2,000–3,000 forms).

**The gate** (`packages/lexicon/scripts/size-gate.mjs`, hard in `src/index/clxi/clxi.test.ts`, reported by
`bench:index`):

| Gate | f1 (with GADDAG, bundled today) | f0 (no GADDAG) |
|---|---|---|
| Absolute cap = mobile `lexiconBytes` (`apps/mobile/bundle-budget.json`, both platforms) | ≤ 550,000 B | ≤ 550,000 B |
| Density | ≤ **215 B/form** | ≤ 128 B/form |
| Batch-3 ceiling | ≤ **2,550 forms** | — |
| GADDAG sections | ≤ 6 × DAWG sections | — |

- The numbers fit together: ceiling = ⌊550,000 / 215 / 50⌋ × 50 = 2,550 (a test checks this). Density × ceiling
  ≤ cap, so while both gates hold, the cap holds up to the ceiling. The density gate gives the early warning that
  the cap alone could not.
- 215 B/form is 14 % above today's 189 and about 5 % above the worst real+synthetic value (205.4, seed 4 at 2,750 forms). A batch that is
  less dense than real tech vocabulary, or a builder regression, fails before it eats the cap.
- The ceiling is 5–8 % below the measured cap crossing. Above 2,550 forms, f1 is no longer planned to fit, and the
  switch rule below decides. Raising the cap is not part of that rule.
- `clxi.test.ts` checks the real f1 and f0 artefacts. It also checks two real+synthetic projections (seed 1) at
  2,000 forms (the AC-14 target) and at the 2,550-form ceiling, so a builder change that breaks the batch-3 plan
  fails in CI before the content arrives.
- `test/size-gate.test.mjs` checks that the cap equals `lexiconBytes` on every platform of
  `apps/mobile/bundle-budget.json`. `prepare:lexicon` keeps enforcing the cap on the file it bundles. The mobile
  budget value is unchanged (550,000 B): the new gate adds density and a ceiling on the lexicon side and does not
  move the cap.

**f0 switch rule (pre-agreed, numeric; used by ST0 for the Strategist budget).** `bundledFlags()` in
`size-gate.mjs` encodes it:

1. **Keep f1** while the f1 artefact of the bundled profile passes every f1 gate above.
2. **Switch to f0** (`BUNDLED_FLAGS = 0` in `apps/mobile/scripts/lexicon-asset.mjs`, a one-line PR with no new
   design review) on the first lexicon change that makes f1 fail a gate, when both hold:
   - f0 passes its gates;
   - DAWG-path generation time is **≤ 1.5×** the GADDAG path's: p95 per-position time over the ≥ 200 mid-game
     positions of the bots `qa2` bench, on the lexicon being shipped. Measured: 1.44× on the real 1,501 forms,
     1.45× on synthetic 2,000, 1.43× on synthetic 50,000 (bots-api §6).
3. **Escalate** otherwise (f0 also fails, or the ratio is above 1.5×). lexicon-engineer, mobile-engineer and
   ai-engineer then choose between CDN delivery, a reviewed cap change and cheaper generation. The cap is never
   raised silently.

**Consequence for the Strategist budget (ST0).** Size the budget so it holds on f0 from the start: assume
`c_node(f0) = 1.5 × c_node(f1)`, that is `maxNodes = ⌊(T_target − T_fixed − maxCandidates × c_eval) / (1.5 ×
c_node,GADDAG)⌋` with the bots-api §5 constants. Then a switch under rule 2 changes neither the budget nor
`BOT_VERSION`, and the device time stays within budget.

The node count is not the issue: DAWG ÷ GADDAG nodes per position are 100–121 % on the real lexicon at p50/p95, and
`maxNodes` bounds both. On two-blank positions the time ratio reaches 1.73× (synthetic 2,000, p95), but the same node
cap bounds them.

One residual point for ai-engineer: with a binding budget the two paths may choose differently (P-BOT-03 only
guarantees equality without budget exhaustion). Pin bot goldens on the variant the app ships.

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
| T-GADDAG | the language of the GADDAG (all accepted paths, un-reversed) equals the DAWG language; every (form, split) path exists; `crossCheck(before, after)` equals brute force over the form set. *Done (L5, `src/index/clxi/gaddag.test.ts`):* every path exists and is final, the language is exactly those paths (no extra words), `dawg` enumerates exactly the forms in `FormRef` order, `crossCheck` via the GADDAG ≡ index `crossCheck` ≡ brute force at every position of every form and on 3,000 random contexts — binary and reference, fixture and real data | property |
| T-REL | `related` symmetric and irreflexive; every data edge with both ends in the profile is present with its type; no neighbour outside the profile | property |
| T-DETERMINISM | building twice ⇒ identical bytes; shuffled file order, `\` paths and CRLF ⇒ identical bytes (after T1); golden sha256 for the fixture lexicon committed; Linux vs macOS CI comparison | unit + CI |
| T-ROUNDTRIP | `decode(encode(model))` equals `model`; `encode(model(decode(bytes)))` equals `bytes` | property |
| T-BLOCKLIST | fixture with a blocklisted playable form ⇒ `Err(BLOCKLISTED_FORM)`; no artefact section contains a blocklisted form | unit |
| T-PROFILE | resolved set equals the set expression evaluated by the reference implementation on fixture tags/categories/ids; empty profile ⇒ `Err(EMPTY_PROFILE)` | property |
| T-CORRUPT | truncation, bit flips, wrong magic, unknown format ⇒ typed `Err`, never a throw, never a wrong answer; with a recomputed CRC, semantic invariants are still checked (one canonical form per term, LETTERS = counts of the forms, u16 values, unique term ids, every category used, zero padding, no trailing bytes) and any artefact that still decodes is coherent; unaligned Node `Buffer` inputs (offsets 1..7) decode | fuzz + unit |
| T-VERSION | header version equals `loadLexicon().version`; mismatched `expect` ⇒ `Err(VERSION_MISMATCH / PROFILE_MISMATCH)`. **Gate:** L4 must make this pass before adding format 1 to `SUPPORTED_FORMAT_VERSIONS` (TODO in `decode.ts`), otherwise `expect` is silently ignored | unit |
| T-ORACLE | for every query in the above suites, binary index and `Set`-backed reference give identical answers; for both implementations (L3 first), mutating the array returned by `letterCounts()` (after a cast, or a frozen-array write attempt) leaves the next `letterCounts()` unchanged | differential |

Per the role rules, each validator invariant touched by T1 (canonical hash, profile files) gets fixtures that must
fail.

## 8. Task breakdown (E-1.2)

| ID | Task | Owner | Reviewers | Depends on | Size |
|---|---|---|---|---|---|
| T0 | Review this note; settle Q-G*, Q-A* | lexicon-engineer | game-engine-engineer, ai-engineer | — | S |
| T1 | Canonical `lexiconVersion`, `data/profiles/*.json` + schema + validator rules, `.gitattributes` (`eol=lf` for data), `LEXICON_SPEC.md` §6 update | lexicon-engineer | lexicon-curator, game-designer (profile semantics) | T0 | S |
| T2 | TypeScript in `packages/lexicon` (`src/`, tsconfig, strict Vitest preset, ESLint) keeping `validate.mjs` zero-dependency — done (sprint L2) | lexicon-engineer | devops-sre | sprint S2, S5 | S |
| T3 | Types: `LexiconIndex`, `Gaddag`, errors (this note §2) — done (sprint L2) | lexicon-engineer | game-engine-engineer, ai-engineer | T2 | S |
| T4 | `Set`/`Map` reference implementation (test oracle; unblocks E-1.1 immediately) — done (sprint L3) | lexicon-engineer | game-engine-engineer | T3 | S |
| T5 | DAWG build + minimisation + rank, encoder/decoder v1, CRC32 — done (sprint L4; normative layout in `src/index/clxi/format.ts`, adds TERM_FORM/FORM_TERM/FORM_KIND tables for the FormRef/TermRef split) | lexicon-engineer | code-reviewer | T3 | M |
| T6 | GADDAG build + traversal + `crossCheck` — done (sprint L5: 15-section format 1, flags bit 0, `LexiconIndex.dawg`, T-GADDAG) | lexicon-engineer | ai-engineer | T5 | M |
| T7 | Property/differential/fuzz tests, golden fixtures | lexicon-engineer | qa-engineer | T4–T6 | M |
| T8 | Benchmarks, size gate, synthetic scale corpora, CI wiring — benchmark JSON and CI artefact done (sprint L6, non-gating, §5); size gate restated above 2,000 forms with the f0 switch rule and scale corpora done (sprint 3 P7, §5.1) | lexicon-engineer | devops-sre | T5–T6 | S |
| T9 | `build:index` CLI, Turborepo task, manifest — done (CLI and manifest sprint L4, global profile only; cached Turborepo task, `current.json` pointer and `@codelex/lexicon/indexes` resolver sprint L6, §3.4) | lexicon-engineer | devops-sre | T5 | S |
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
