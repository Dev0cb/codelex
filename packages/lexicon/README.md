# @codelex/lexicon

The CODELEX Lexicon — the structured corpus of technology terms the game is played with.

- **Owners**: `lexicon-engineer` (schema, validator, index build) · `lexicon-curator` (content)
- **Spec**: `docs/game/LEXICON_SPEC.md`

## Layout
```
schema/term.schema.json   JSON Schema (source of enums used by the validator)
scripts/formulas.mjs      gameValue / knowledgeXp formulas (single source of truth)
scripts/validate.mjs      structural + graph invariants; prints lexiconVersion (content hash)
data/categories.json      category registry (EN/FR names, icon, colour token)
data/terms/<category>.json terms whose primary category is <category>
data/blocklist/*.txt      forms that must never be playable
```

## Commands
```bash
pnpm lexicon:validate                      # from repo root
pnpm --filter @codelex/lexicon test        # unit tests (node:test)
```

## Invariants
Unique ids and playable forms · forms `^[A-Z]{2,15}$` · no dangling/self/duplicate relations · no `is_a` cycles ·
products declare their trademark owner · definitions are original, ≤ 160 chars, EN + FR · computed values may
only differ from the formula with an approved `override`.

Next (roadmap E-1.2): GADDAG index build per lexicon profile and the `LexiconIndex` interface for the engine.
