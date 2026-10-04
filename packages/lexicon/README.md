# @codelex/lexicon

The CODELEX Lexicon — the structured corpus of technology terms the game is played with.

- **Owners**: `lexicon-engineer` (schema, validator, index build) · `lexicon-curator` (content)
- **Spec**: `docs/game/LEXICON_SPEC.md`

## Layout

```
schema/term.schema.json   JSON Schema, term-file schemaVersion 2 (source of enums/limits used by the validator)
scripts/formulas.mjs      gameValue / knowledgeXp formulas (single source of truth)
scripts/canonical.mjs     RFC 8785 canonical JSON; lexiconVersion and cardsVersion (ADR-0013 §D7)
scripts/validate.mjs      structural + graph + form-namespace rules; NEEDS_REVIEW warnings; batch report
scripts/migrate-v1-to-v2.mjs  term-file migration v1 -> v2 (bumps schemaVersion only, idempotent)
scripts/size-gate.mjs     `.clxi` size gate numbers and the f0 switch rule (lexicon-index note §5.1)
scripts/scale-corpus.mjs  seeded synthetic / real+synthetic scale corpora for the size gate (trends only)
data/categories.json      category registry (EN/FR names, icon, colour token)
data/terms/<category>.json terms whose primary category is <category>
data/blocklist/*.txt      forms that must never be playable
src/index/                TypeScript: the `@codelex/lexicon/index` contract (types, constants, decoder)
test/*.test.mjs           node:test suites for the scripts (zero dependencies)
```

## Two toolchains, on purpose

- `scripts/*.mjs` (validate, canonical, formulas, migrate) are **plain Node ESM with zero dependencies**. The CI job
  "Framework & lexicon validation" runs `node packages/lexicon/scripts/validate.mjs` **before** `pnpm install`, so
  these files must never import a package, TypeScript or a build output. ESLint and Prettier check them (as plain
  JS); `node --test` runs their tests.
- `src/` is TypeScript built with `tsc` to `dist/` and checked with the `@codelex/config` presets (ESLint
  `codelex()`, Prettier, Vitest **strict** 90 % preset: the index is on the rules path and imported by
  `packages/game-engine`). It may import `@codelex/config/result` only and must stay pure (no Node built-ins, no
  IO): the engine imports its types, mobile (Hermes) runs the decoder.
- `data/` and `schema/` are excluded from Prettier (`.prettierignore`): their layout is curated, and both versions
  are computed over canonical JSON.

## API

| Import                                                 | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@codelex/lexicon/index`                               | `LexiconIndex` (`has`, `lookup`/`lookupCodes` → `FormRef`, `termOf` → `TermRef`, `formMeta`, `meta`, `related`, `crossCheck`, `dawg`, `gaddag`, ...), `Dawg` / `Gaddag` (arc-walking automata for move generation), `FormRef`/`TermRef`/`LexiconVersion`/`DefinitionHash`/`CategoryId` brands, read-only `LetterCounts`, `LexiconIndexError`, `decodeLexiconIndex` (`.clxi` format 1: CRC-32, flags and full structural validation including the exact GADDAG language, typed-array views, `expect` checks), `buildLexiconIndex` / `buildDawg` / `buildGaddag` (deterministic builder: minimal DAWG with ranks and optional minimal GADDAG, format in `src/index/clxi/format.ts`), schema enums as constants, and `createReferenceIndex` — the `Map`/`Set` reference implementation built from the canonical document D, with plain-trie `dawg`/`gaddag` (the T-ORACLE and T-GADDAG oracle of the binary index). Spec: `docs/architecture/notes/lexicon-index.md` §2. |
| `@codelex/lexicon/validate`, `/canonical`, `/formulas` | the zero-dependency scripts (`loadLexicon`, `lexiconVersion`, value formulas)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `@codelex/lexicon/indexes`                             | zero-dependency resolver of the `build:index` output: `INDEXES_DIR`, `readIndexManifest`, `resolveIndexArtefact({ profileId, flags })` (size and sha256 checked against the manifest), `IndexArtefactError` codes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `@codelex/lexicon/schema/term.schema.json`, `/data/*`  | schema and data files                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Commands

```bash
pnpm lexicon:validate                      # from repo root; prints lexiconVersion, cardsVersion, report
node packages/lexicon/scripts/validate.mjs --report report.json   # same, plus the JSON batch report
pnpm --filter @codelex/lexicon test        # node:test suites (scripts) then Vitest with coverage (src)
pnpm turbo run build lint typecheck format:check test --filter=@codelex/lexicon
pnpm turbo run build:index                 # cached; dist/indexes/current.json → <lexiconVersion>/{manifest.json,*.clxi}
pnpm turbo run bench:index --filter=@codelex/lexicon   # dist/bench/index-bench.json (reporting only)
```

## Invariants (full list: LEXICON_SPEC §5)

Unique ids · one global namespace for canonical forms and inflections (a standalone term owns its string) · forms
`^[A-Z]{2,15}$`, never blocklisted · inflections: ≤ 4, sorted, no duplicates, not two-letter, not on `product` /
`language` / non-playable terms · no dangling/self/duplicate relations · no `is_a` cycles · products declare their
trademark owner · definitions are original, 10–160 chars, EN + FR · computed values may only differ from the
formula with an approved `override`. Irregular inflections and unsourced product/protocol/standard terms print
`NEEDS_REVIEW` warnings (non-blocking) until fixed or, for inflections, confirmed by the curator (below).

## Inflections (schema v2)

```json
{ "id": "pod", "form": "POD", "...": "...", "inflections": [{ "form": "PODS", "kind": "plural" }] }
```

Kinds: `plural | verb_s | verb_ed | verb_ing` (batch 1: plurals only). An inflection is a playable form that
resolves to its canonical term for every rule, card and XP; it carries no metadata of its own.

**Irregular forms (AC-14: 0 open NEEDS_REVIEW).** An inflection that does not start with the term's form
(QUERIES, INDICES) or lacks its kind's suffix is fixed, or confirmed by the curator on the entry:

```json
{
  "form": "QUERIES",
  "kind": "plural",
  "confirmed": {
    "approvedBy": "lexicon-curator",
    "reason": "Regular English plural: consonant + y becomes -ies (query, queries). ..."
  }
}
```

A confirmed entry stops warning, while any other irregular entry, including a new one on the same term, still
warns. `confirmed` on a regular form is an error. `reason` is 10–160 characters. The field is review metadata:
neither version changes (LEXICON_SPEC §2.1). The report counts confirmations in `confirmedInflections`. Six are
confirmed today: VULNERABILITIES, QUERIES, BATTERIES, PROXIES, LIBRARIES and INDICES.

## Size gate (lexicon-index note §5.1)

`scripts/size-gate.mjs` holds the gate. `clxi.test.ts` applies it to the real artefacts and to two real+synthetic
projections (2,000 forms and 2,550 forms). `bench:index` reports it, together with a scale table at 2,000, 2,500
and 3,000 forms.

| Variant          | Cap         | Density      | Ceiling       | Other             |
| ---------------- | ----------- | ------------ | ------------- | ----------------- |
| f1 (with GADDAG) | ≤ 550,000 B | ≤ 215 B/form | ≤ 2,550 forms | GADDAG ≤ 6 × DAWG |
| f0 (no GADDAG)   | ≤ 550,000 B | ≤ 128 B/form | —             | —                 |

- The cap equals `lexiconBytes` in `apps/mobile/bundle-budget.json` (a test checks this).
- Today (1,501 forms), f1 is 189.0 B/form and f0 is 66.7 B/form.
- f0 switch rule (`bundledFlags()`): keep f1 while it passes. On the first change that fails an f1 gate, bundle f0
  if f0 passes and DAWG-path generation p95 time is ≤ 1.5× the GADDAG path's (bots `qa2` bench). Otherwise
  escalate. The cap is never raised silently.

## Versions

- `lexiconVersion` — SHA-256 (16 hex) of the RFC 8785 canonical document of the playable content (forms,
  inflections, kinds, playable, difficulty, categories, relations, tags, effective values, category ids, blocklist).
  Exact field list: LEXICON_SPEC §7. Independent of files, key order, whitespace and line endings.
- `cardsVersion` — same construction over display-only content (definitions, display, owner, sources, aliases,
  category names). Fixing a definition never changes `lexiconVersion`.
- AC-2 evidence (schema v1 -> v2 migration, 2026-10-02): the canonical `lexiconVersion` of the pre-migration v1
  seed (commit `d955d97`) is `2f2cc6fca8fac92b`, identical after migration (`schemaVersion` is not hashed); the
  310 playable forms are unchanged. The old validator printed `f654db78a4264004`, a raw-file hash with a different
  formula that was never published or pinned.

`pnpm turbo run build:index` (Turborepo task, cached on data, schema, scripts, builder source and package config;
lexicon-index note §3.4) writes, per profile, two artefacts that differ only by
the header flags: `dist/indexes/<lexiconVersion>/global-ranked.f1.clxi` (with the GADDAG, flags bit 0: server and
default) and `global-ranked.f0.clxi` (without it: mobile fallback, bots use `dawg`), plus `manifest.json` (one entry
per profile and flags: `flags`, `gaddag`, sha256, bytes, `definitionHash`). The build refuses unloadable or invalid
data and any artefact that does not decode as the expected version, profile and GADDAG presence (`--data <dir>`
builds another data directory). Artefacts are reproducible and git-ignored. `dist/indexes/current.json` points at the only version directory;
consumers read it through `@codelex/lexicon/indexes` (`resolveIndexArtefact({ profileId, flags })` checks size and
sha256 against the manifest) and make their task depend on `@codelex/lexicon#build:index`. `pnpm turbo run
bench:index --filter=@codelex/lexicon` writes `dist/bench/index-bench.json` (reporting only; CI uploads it).
Sizes on `4fa5884050b4ea53` (1,501 forms): 283,672 B with the GADDAG, 100,160 B without (GADDAG sections 4.71× the
DAWG sections; gate ≤ 6×). The Turborepo task (T9) and benchmark JSON in CI (T8) are done (sprint L6); the size
gate and scale corpora are done in sprint 3 (P7). Next (roadmap E-1.2): season/org profile files (T-PROFILE).
