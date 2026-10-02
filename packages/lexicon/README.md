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
data/categories.json      category registry (EN/FR names, icon, colour token)
data/terms/<category>.json terms whose primary category is <category>
data/blocklist/*.txt      forms that must never be playable
```

## Commands
```bash
pnpm lexicon:validate                      # from repo root; prints lexiconVersion, cardsVersion, report
node packages/lexicon/scripts/validate.mjs --report report.json   # same, plus the JSON batch report
pnpm --filter @codelex/lexicon test        # unit tests (node:test)
```

## Invariants (full list: LEXICON_SPEC §5)
Unique ids · one global namespace for canonical forms and inflections (a standalone term owns its string) · forms
`^[A-Z]{2,15}$`, never blocklisted · inflections: ≤ 4, sorted, no duplicates, not two-letter, not on `product` /
`language` / non-playable terms · no dangling/self/duplicate relations · no `is_a` cycles · products declare their
trademark owner · definitions are original, 10–160 chars, EN + FR · computed values may only differ from the
formula with an approved `override`. Irregular inflections and unsourced product/protocol/standard terms print
`NEEDS_REVIEW` warnings (non-blocking).

## Inflections (schema v2)
```json
{ "id": "pod", "form": "POD", "...": "...", "inflections": [{ "form": "PODS", "kind": "plural" }] }
```
Kinds: `plural | verb_s | verb_ed | verb_ing` (batch 1: plurals only). An inflection is a playable form that
resolves to its canonical term for every rule, card and XP; it carries no metadata of its own.

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

Next (roadmap E-1.2): GADDAG index build per lexicon profile and the `LexiconIndex` interface for the engine.
