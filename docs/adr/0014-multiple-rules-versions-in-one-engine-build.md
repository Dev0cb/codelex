# 0014 — Multiple rules versions in one engine build

- Status: Accepted (delegated by the product owner, 2026-10-04; sprint task P1)
- Date: 2026-10-04
- Deciders: product owner (human), solution-architect, game-engine-engineer, ai-engineer, lexicon-engineer,
  mobile-engineer
- Reversibility: **One-way door** once action logs of two rules versions exist side by side (the first v2 log
  exported or persisted next to v1 logs). From then on every frozen `RulesSet` stays in the registry, or an
  archived build must replay it. Before that, everything here is reversible by editing the registry. The draft
  mechanism (§D4) and the `gameValue` decoupling (§D5) are two-way doors.
- Partly supersedes: **ADR-0013 §D6** ("the engine implements exactly one rules version"; the Phase 1 "cannot be
  resumed after an app update" rule) and the **last sentence of ADR-0013 §D5** (the `letters-v1` table "must equal
  the LEXICON_SPEC §4 `letterValue` table used for `gameValue`, or both change together"). Everything else in
  ADR-0013 stays in force, including the §D5 definition of `engineRulesVersion` and its bump rule. ADR-0013's
  status line is updated to "partly superseded by 0014" when this ADR is accepted (only the status line changes).

> ADR-0011 is an intentional gap: the number is reserved for protocol/event versioning (E-2.3). `docs/adr/` has no
> index or README; this note, ADR-0012 and ADR-0013 record the gap.

## Context

Sprint task P1 (`docs/sprints/2026-10-04-phase1-playtest-gates.md`), required before any v2 engine code (E6, B3,
L7). Inputs: `docs/game/decisions/2026-10-b2-response.md` (D3, D4, T-2, T-3, T-6, §9.1),
`docs/architecture/notes/game-engine-api.md` (§4.1, §6, §15), ADR-0013.

- **`engineRulesVersion` 2 is coming, and it might lose.** v2 changes three outcome tables at once: the plain start
  square (layout `classic-v2`, D4), lower term bonuses (0/3/6/12 or 0/2/4/8, D3), and `letters-v2` derived from
  batch 3 (R-BAG-001). A pre-registered `/balance-check` decides between v1 and v2 by D0+9. If v2 fails, the
  playtest ships v1 (§9.1 fallback).
- **ADR-0013 §D6 assumed one version per build.** Under it, the build that adds v2 can no longer create, resume or
  replay v1. Three needs break:
  1. The simulator cannot run v1 and v2 in one process. T-2 asks for v2 on the real engine, not a dist patch.
  2. The §9.1 fallback would need a revert of the engine constants.
  3. v1 golden replays (`test/golden/replays/v1/`, GC-DET-01) and playtest "Send match log" exports would stop
     replaying on `main`.
- **The engine is already data-driven.** In the code today, the rules tables are reached through three
  lookups: `getLayout(state.config.layout)`, `getLetterTable(state.config.letters)` and the module constant
  `RULES` (`packages/game-engine/src/rules/constants.ts`). The engine never reads a term's `gameValue`. The term
  bonus is `RULES.termBonus[difficulty]` (`src/scoring/score.ts`). The only version-specific code is the equality
  check against `ENGINE_RULES_VERSION` in `createMatch`, `apply`, `evaluateMove`, `parseState` and
  `parseActionLog`.
- **The lexicon spec couples to v1.** LEXICON_SPEC §4 defines `gameValue` with the `letters-v1` values and the v1
  term bonus. R-SCORE-003 says the bonus constants are "the same as the lexicon game value". Once v2 changes
  either table, one of the two statements must give way (T-6).
- **Constraints.** CLAUDE.md §1.2 (one rules engine, no duplicated rule logic), ENGINEERING §3 (determinism),
  ADR-0013 §D4 (purity, no module state), the Hermes budget (`apply` < 10 ms), and the Android bundle at 87 % of
  its limit (sprint risk 5).

## Options considered

### 1. How one build serves several rules versions

| Option | Pros | Cons |
|---|---|---|
| A. **Keep ADR-0013 §D6**: one version per build; old versions replay on archived builds | engine stays exactly as today; no registry | the simulator needs two builds to compare v1 and v2 (T-2 rejects dist patches); the §9.1 fallback becomes a revert; v1 goldens and playtest logs stop replaying on `main`; Phase 1 matches are lost at every bump; the archive and replay worker are needed from Phase 1 instead of Phase 2 |
| B. **Frozen per-version registry of data, one shared code path** (`RulesSet` keyed by `engineRulesVersion`) | v1 and v2 differ only in tables the engine already reads by id; every version runs through the same tested code; v1 replays forever on every build; the simulator and the fallback are a parameter, not a build; ≈ 1–2 KB of data per version | once two versions have logs, a version can never be removed (the one-way door); any future rule that cannot be expressed as data needs a data flag on the shared path, or a revisit (trigger below) |
| C. Per-version code modules (`src/v1/…`, `src/v2/…`) | full freedom per version | duplicates rule logic, against CLAUDE.md §1.2; dead branches in the hottest code (ADR-0013 rejected option B for this reason); test and coverage cost per version; drift between copies |
| D. Caller-injected constants (`ctx.rules`) with no registry | most flexible for the simulator | the log stops being self-describing; any caller can pair a v1 header with v2 tables; a trust-boundary problem in Phase 2; violates "same version ⇒ same outcome" |

### 2. How `gameValue` stops depending on engine constants (T-6)

| Option | Pros | Cons |
|---|---|---|
| G1. **The lexicon carries a per-version value** (`gameValue` per `engineRulesVersion`, or a per-version bonus table in the lexicon) | Knowledge Cards read one field per version | rules data moves into lexicon content: every rules version changes every term and `lexiconVersion` (a `contentFormat` bump); the `.clxi` `TERMS` section stores one `u16 gameValue` (format change right before the P4 format-1 freeze); every draft candidate needs its own lexicon build; the engine would score from lexicon data, which breaks ADR-0013 §D5 ("a lexicon release never changes scoring") |
| G2. **The engine computes the term bonus from difficulty** (`RulesSet.rules.termBonus[difficulty]`). `gameValue` stays a lexicon value that no longer depends on any rules version. | this is already the code path; no lexicon, index or `lexiconVersion` change; balance candidates are pure engine data; rules and lexicon releases stay independent (ADR-0013's main benefit) | `gameValue` (KUBERNETES = 43) is no longer "what the word scores in game"; Knowledge Card copy that shows the in-game bonus must read it from the engine for the pinned version (T-8) |

## Decision

**Option B (registry) and G2 (engine computes the bonus; `gameValue` decoupled).**

### D1. The rules registry

The engine holds a frozen, module-level, read-only registry of `RulesSet`s keyed by `engineRulesVersion`. It is
constant data, not mutable module state (ADR-0013 §D4 and API note §17.2 still hold).

```ts
export type EngineRulesVersion = 1 | 2;          // grows by one literal per registered version

export interface RulesSet {
  readonly engineRulesVersion: EngineRulesVersion;
  /** 'frozen' = published, immutable forever. 'draft' = still being tuned, refused unless opted in (§D4). */
  readonly status: 'frozen' | 'draft';
  /** GAME_RULES version this set implements, e.g. '0.3.1'; '0.4-draft' while v2 is a draft. */
  readonly gameRules: string;
  /** Allowed `MatchSetup.layout` ids (ascending, ≥ 1). Frozen versions normally allow exactly one. */
  readonly layouts: readonly LayoutId[];
  /** Allowed `MatchSetup.letters` ids (ascending, ≥ 1). */
  readonly letterTables: readonly LetterTableId[];
  /** Every other outcome-affecting constant: today's `RULES` object, `termBonus` included. */
  readonly rules: Rules;
}

export const RULES_VERSIONS: readonly EngineRulesVersion[];      // every registered version, ascending
export function rulesFor(version: EngineRulesVersion): RulesSet;  // programmer error (throws) if unknown
export function isRulesVersion(value: unknown): value is EngineRulesVersion;
/** First 16 hex of SHA-256 over the JCS of the RulesSet, its layouts and its letter tables (pinned for frozen sets). */
export function rulesDigest(version: EngineRulesVersion): string;
```

- **Versions differ in data only, through one code path.** Every function resolves `rulesFor(x.engineRulesVersion)`
  once per call and passes the set down. The module constant `RULES` is no longer read inside the engine. The
  layout and letter table still come from `getLayout(setup.layout)` and `getLetterTable(setup.letters)`, and
  `createMatch`/`parseState`/`parseActionLog` check them against the version's allowed lists. A future difference
  that is behaviour, not a value (a new action type, a clock), arrives as a data flag in `RulesSet` read by the
  shared code, never as a `switch (version)`. Lint (owner devops-sre) bans comparisons of `engineRulesVersion` with
  a numeric literal in `packages/game-engine/src`, outside `rules/registry.ts`.
- **Version 1** = `{ status: 'frozen', gameRules: '0.3.1', layouts: ['classic-v1'], letterTables: ['letters-v1'],
  rules: <today's RULES> }`. Its outcomes, state hashes and GC-DET-01 final hash `59b0b2f2d2ca6c60` must not
  change: this is E6's first acceptance criterion.
- **Version 2 (draft until rules PR 0.4)** = `classic-v2` (R-BOARD-004 plain start, D4), a v2 `termBonus`
  (candidates in §D4), and `letters-v2` (T-4a; until L7 fills it, the slot holds a copy of `letters-v1` and the
  set stays a draft). While v2 is a draft it also allows `classic-v1`, so the pre-registered D4 confirmation
  (DW vs plain start under v2 bonuses and `letters-v2`) runs on the real engine. The freeze decides which layouts
  remain.
- **Pinned digests.** `test/golden/rules-digests.json` records `rulesDigest(v)` for every frozen version. The file
  is append-only and covered by the P3 golden-immutability check. Editing a frozen table therefore fails twice:
  on its digest and on its replay goldens.
- **Removal.** A frozen version is never removed from the registry without a new ADR. If one ever is, ADR-0013 §D6
  option C (archived build + replay worker) becomes the only replay path for its logs.

### D2. Header and state: unchanged shape, values checked per version

- `MatchConfig`, `MatchSetup`, `MatchState` and the log envelope keep their shape. `logVersion` stays 1, because
  no envelope, header or action encoding changes. A v2 header differs from a v1 header only in its values
  (`engineRulesVersion: 2`, `layout`, `letters`).
- `MatchSetup.layout` and `MatchSetup.letters` stay in the header (API note §20 Q4). They are what makes the D4
  DW-vs-plain comparison self-describing in a draft, and they cost about 40 bytes per log.
- Allowed ids per version:

  | `engineRulesVersion` | status | `layout` | `letters` | `termBonus` (nov/int/adv/exp) |
  |---|---|---|---|---|
  | 1 | frozen | `classic-v1` | `letters-v1` | 0/4/8/16 |
  | 2 | draft → frozen by rules PR 0.4 | `classic-v2` (draft also: `classic-v1`) | `letters-v2` | draft candidates 0/3/6/12 and 0/2/4/8; one is chosen at the freeze |

- A version that is not registered, or a registered layout/letters id outside the version's lists, fails exactly
  as today: `RULES_VERSION_UNSUPPORTED` and `INVALID_CONFIG` (`config.layout` / `config.letters`).
- **Literal types bound what data can express.** `Layout.size: 15`, `LetterTable.blanks: 2`,
  `LetterTable.blankValue: 0` and the literal `Rules` members (`rackSize: 7`, `fullStackBonus: 50`, `chainStep: 5`,
  …) are type-level constants. v2 changes none of them. A future 11×11 board (the BALANCE fallback, currently
  moot by D1-c) would therefore need **v3**, and the PR that adds it widens `size` to `15 | 11`. That PR is a typed
  API change for bots and mobile (board rendering, anchor scans), not only data.

### D3. Replays and logs

- **`test/golden/replays/v1/**` is never modified.** The P3 CI check enforces this, and v1 logs replay on every
  future build forever. `replay(log)` takes its version from `log.header.engineRulesVersion`; v1 and v2 logs
  coexist in one store and one code path.
- Golden layout: `test/golden/replays/v<N>/` exists only for frozen versions and is immutable from its first
  commit. Draft goldens live in `test/golden/drafts/v<N>/` and may change with the draft. The immutability check
  does not cover them. At the freeze (R4), the draft goldens are regenerated and committed once to
  `replays/v<N>/`, and `drafts/v<N>/` is deleted.
- `test/golden/scoring/v1/` is immutable in the same way; v2 scoring goldens follow the same draft → freeze path.
- **On device (supersedes the ADR-0013 §D6 Phase 1 rule).** A local in-progress match resumes after an app update
  as long as its version is registered and frozen, which is always true for v1. The "match from an older version
  can't be resumed" state is now reached only on a downgrade, or when a log names a draft version.
- **Phase 2 (unchanged from ADR-0013 §D6 except the mechanism).** A live match finishes on the version it started
  with. Rolling deploys need no "current and previous" special case, because every build serves every frozen
  version. The archived-build replay worker becomes a backstop, needed only if a version is ever removed. The
  **server** chooses `engineRulesVersion` for ranked, tournament and Daily play. A client-supplied version is never
  trusted (threat model: security-engineer, E-2.3).

### D4. Draft versions

- A `RulesSet` with `status: 'draft'` promises nothing. Its tables may change between commits without a version
  bump, and its logs and hashes are never compared across builds or published.
- **`createMatch` refuses a draft** with `RULES_VERSION_UNSUPPORTED` and `details: { actual: <v>, status: 'draft' }`
  unless the context carries the opt-in. `parseState`, `parseActionLog` and `replay` refuse drafts the same way, so
  a draft state or log can never enter the app through resume or "Send match log".
- **The opt-in is a token, not a flag.** `ALLOW_DRAFT_RULES` (a frozen object compared by identity) is exported only
  from a third package entry, `@codelex/game-engine/draft`. The context is extended as follows:

  ```ts
  export interface EngineContext {
    readonly lexicon: EngineLexicon;
    /** Simulator and engine tests only. Never stored in state, never logged. */
    readonly draft?: { readonly optIn: DraftOptIn; readonly candidate?: string };
  }
  ```

  `candidate` selects one of a draft's named `Rules` candidates (v2: `tb-0-3-6-12`, `tb-0-2-4-8`). The candidate is
  not in the header or the hash. That is acceptable only because draft hashes promise nothing. The simulator
  records `engineRulesVersion`, `candidate` and `rulesDigest` in every results JSON, so a readout is tied to the
  exact draft tables. A frozen set has no candidates.
- **Lint:** `no-restricted-imports` bans `@codelex/game-engine/draft` under `apps/**` and `services/**`, enforced
  in the shared `@codelex/config` presets (owner devops-sre). It is allowed in `packages/bots/sim/**` and in test
  files of `packages/game-engine` and `packages/bots`.
- **Freeze.** Rules PR GAME_RULES 0.4 (task R4) does five things:
  1. sets v2 to `status: 'frozen'`;
  2. removes the losing candidate and any draft-only layout;
  3. sets `gameRules: '0.4'`;
  4. pins `rulesDigest(2)`;
  5. commits `replays/v2/`.

  From that commit, v2 follows the ADR-0013 §D5 bump rule like v1.
- **If v1 wins the gate (§9.1).** v2 stays a draft, or is deleted. No log of it was ever published, so the number
  2 may be reused by the next candidate. Nothing has to be reverted.

### D5. `gameValue` decoupling (T-6): the engine computes the term bonus from difficulty

- **Scoring.** The term bonus is `rulesFor(v).rules.termBonus[difficulty(term)]`, per R-SCORE-003, for the match's
  version. This is the current code path (`src/scoring/score.ts`). The engine never reads `gameValue`, and
  `EngineLexicon` gains no member.
- **`gameValue` keeps its LEXICON_SPEC §4 formula and numbers unchanged.** It is redefined as a **lexicon value
  that does not depend on any rules version**. Its `letterValue` and `difficultyBonus` tables are frozen inside
  LEXICON_SPEC as lexicon constants (today's numbers, which equal `letters-v1` and the v1 bonus by history only).
  They are no longer "the in-game values", so nothing in the lexicon changes when a rules version changes.
  `lexiconVersion`, `.clxi` and the batch-3 content are unaffected. Users of `gameValue` (vision V-05 examples,
  progression, Knowledge Cards) treat it as a stable "word value" for the lexicon.
- **In-game numbers come from the engine.** UI copy that states what a term scores in a match ("expert +8") reads
  `rulesFor(pinned).rules.termBonus`, never `gameValue` (T-8, ux-ui-designer and mobile-engineer).
- **Why G2 and not G1.** G1 moves rules data into lexicon content. Every rules version, and every draft
  candidate, would then change `lexiconVersion` and the `.clxi` format just before the P4 format-1 freeze. It would
  also make lexicon content an input of scoring, which reverses ADR-0013's decoupling of rules and lexicon
  releases. G2 costs one documentation change and keeps both release trains independent.
- Doc follow-ups (L7, owners below): LEXICON_SPEC §4 drops "(letters-v1 = in-game values)" and states the
  decoupling; GAME_RULES R-SCORE-003 drops "same constants as the lexicon game value". The lexicon formula
  itself does not change.

### D6. Public API changes (non-hashed; package semver)

- New: `RulesSet`, `RULES_VERSIONS`, `rulesFor`, `isRulesVersion`, `rulesDigest`, `EngineContext.draft`, and the
  `./draft` entry (`ALLOW_DRAFT_RULES`, `DraftOptIn`).
- `ENGINE_RULES_VERSION` is **deprecated**. It stays exported for one release as the newest *frozen* version (1
  until R4), and no engine code reads it. Consumers pin their own version (§Consequences) instead.
- `RULES` is **deprecated** (= `rulesFor(1).rules`). Bots read `rulesFor(obs.engineRulesVersion).rules`.
- `RULES_VERSION_UNSUPPORTED` details become `{ actual, supported: '<comma-separated frozen versions>' }`, plus
  `status: 'draft'` for a refused draft. The current single-number `expected` no longer has a meaning.

## Consequences

### Positive
- The v1/v2 decision is a parameter. The §9.1 fallback is a one-line change of the app's pinned constant, and the
  balance check runs both versions in one process, on the real engine.
- v1 goldens, GC-DET-01 and playtest exports replay forever on `main`. The Phase 1 "lost match after update" cost
  of ADR-0013 disappears for frozen versions.
- One code path keeps one test suite, so coverage and property tests apply to every version. The registry adds no
  `switch (version)`.
- Rules and lexicon releases stay independent (G2).

### Negative / costs
- Frozen versions accumulate as data (≈ 1–2 KB each in the bundle, including the 225-square layout). The Android
  bundle budget must absorb about 2 KB for v2.
- A future behaviour difference needs a `RulesSet` flag and shared-path code that stays live for every version
  that uses it.
- Draft hashes are not comparable across commits. Anyone reading a draft readout must check `rulesDigest`.
- `gameValue` no longer equals the in-game score of a term. This is documentation and copy work (T-8).

### Consumers

| Consumer | Consequence |
|---|---|
| `packages/bots` | Read constants through `rulesFor(obs.engineRulesVersion).rules` (`ranked.ts`, `fallback.ts` use `RULES` today). Goldens are pinned per (`BOT_VERSION`, `engineRulesVersion`): `test/golden/decisions-v<BOT_VERSION>-r<engineRulesVersion>.json`. A draft rules version gets a mutable draft golden; frozen pairs are immutable. `BOT_VERSION` 2 (B4) pins `-r1`, and `-r2` once v2 freezes. A bot behaviour change bumps `BOT_VERSION` for all rules versions at once. |
| Simulator (`packages/bots/sim`) | `--rules 1` or `--rules 2 --candidate tb-0-2-4-8`, imports `@codelex/game-engine/draft`; results JSON carries `engineRulesVersion`, `candidate`, `rulesDigest`, `BOT_VERSION`, `lexiconVersion` (B3). |
| `apps/mobile` | Pins `PLAY_RULES_VERSION` (an app constant, default `1`) and passes it in every `MatchConfig`. Switching to 2 is an explicit PR after the BC decision, never a remote flag, so a session cannot change version mid-match. Resume and "Send match log" accept any frozen version. The home screen shows the pinned constant instead of `ENGINE_RULES_VERSION`. Lint forbids the draft entry. |
| Replays/logs | One store, one `logVersion`, both versions. The analytics and Sentry context add `engine_rules_version` to match events (`bot_match_*`, data-analyst in SP1). |
| `services/game` (Phase 2) | The server decides the version per queue or event; every build serves every frozen version; the archive worker is a backstop only. |

### Budgets

| Item | Budget |
|---|---|
| `rulesFor` lookup | O(1), once per public call, < 1 µs Node; no change to the `apply` budget (p99 < 1 ms Node, < 10 ms Hermes) |
| Bundle | ≤ 2 KB minified per additional frozen `RulesSet` |
| Storage | none (logs unchanged in size and shape) |
| CI | +1 golden replay set per frozen version (seconds); draft goldens run in the same suite |

### Failure modes
- **App pins a version the build does not register** → `createMatch` returns `RULES_VERSION_UNSUPPORTED`; caught
  by the S1 scripted full-match test.
- **Draft reaches an app build** → it is refused at `createMatch`, `parseState` and `replay`, and the lint
  catches the import first.
- **Frozen table edited by mistake** → `rulesDigest` golden, `replays/v<N>/` and GC-DET-01 fail; the P3
  immutability check blocks edits to the files.
- **Version-specific `if` sneaks into the shared path** → caught by the lint (§D1) and by code review against this
  ADR.

### Follow-up tasks

| Owner | Task | Acceptance criteria |
|---|---|---|
| game-engine-engineer | E6: registry (`rules/registry.ts`), `rulesFor` threaded through create/apply/observe/evaluate/state/log, v2 draft with candidates, `./draft` entry, `rulesDigest` + `rules-digests.json` | v1 GC-DET-01 hash and all v1 goldens unchanged; `RULES` unread inside `src`; draft refused without opt-in at all four entry points (unit); P-API-01/07 run for v1 and for each v2 candidate; coverage ≥ 90 % |
| devops-sre | Lint: ban `@codelex/game-engine/draft` in `apps/**`, `services/**`; ban numeric-literal version comparisons in engine `src` outside the registry; extend the P3 immutability check to `rules-digests.json` and `replays/v*/` | must-fail fixtures for each rule |
| ai-engineer | B3/B4: simulator `--rules/--candidate`; bots read `rulesFor`; goldens per (`BOT_VERSION`, `engineRulesVersion`) | results JSON carries the four identity fields; golden file naming as above |
| lexicon-engineer, lexicon-curator | L7: LEXICON_SPEC §4 text per §D5 (formula unchanged) | `pnpm lexicon:validate` unchanged; `lexiconVersion` unchanged by the doc change |
| game-designer | R-SCORE-003 wording (no tie to `gameValue`); GAME_RULES ↔ `engineRulesVersion` mapping row for 0.4 at the freeze (R4) | traceability gate green |
| mobile-engineer | `PLAY_RULES_VERSION` constant; replace the `ENGINE_RULES_VERSION` display | S1 scripted match on the pinned version |
| ux-ui-designer | T-8: in-match bonus copy reads engine values, not `gameValue` | EN/FR copy reviewed |
| security-engineer | Threat model item for Phase 2: server-chosen `engineRulesVersion`; draft never reachable from a client (feeds E-2.3) | documented, linked from this ADR |

### Revisit triggers
- A rules change cannot be expressed as data on the shared path without a version branch.
- More than 5 frozen versions, or registry data > 10 KB in the bundle.
- A frozen version needs removal (for example, a primitive fault found by the Hermes job). That needs a new ADR
  and the archived-build path of ADR-0013 §D6.
- An 11×11 or other board size is scheduled (v3, §D2).
