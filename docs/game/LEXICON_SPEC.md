# Lexicon Specification

Owners: `lexicon-engineer` (schema, validator) · `lexicon-curator` (content).
Schema: `packages/lexicon/schema/term.schema.json` · Data: `packages/lexicon/data/` · Validate: `pnpm lexicon:validate`.

## 1. Files
- `data/categories.json` — category registry (id, names EN/FR, colour token, icon).
- `data/terms/<category>.json` — `{ "schemaVersion": 1, "category": "<id>", "terms": [Term, …] }`. A term lives in
  the file of its **primary** category and may list secondary categories.
- `data/blocklist/` — forms that must never be playable (offensive collisions), one per line, uppercase.

## 2. Term model
| Field | Type | Rules |
|---|---|---|
| `id` | string | kebab-case, globally unique, stable forever |
| `form` | string | playable form, `^[A-Z]{2,15}$`, unique across lexicon |
| `display` | string | how it's shown (e.g. `Kubernetes`, `C++`, `EC2`) |
| `playable` | boolean | false for forms not representable on the board (digits/symbols) |
| `kind` | enum | `concept`, `product`, `language`, `protocol`, `acronym`, `tool`, `standard` |
| `owner` | string? | required for `product` (trademark owner) |
| `categories` | string[] | ≥ 1, first = primary, must exist in categories.json |
| `difficulty` | enum | `novice`, `intermediate`, `advanced`, `expert` |
| `definitions` | `{en, fr}` | original text, ≤ 160 chars each |
| `aliases` | string[] | other ids or display strings (e.g. `K8S`) |
| `relations` | `{type, target}`[] | typed edges; target = existing term id |
| `sources` | url[] | official docs used to verify (not copied) |
| `tags` | string[]? | free tags (season packs, missions) |
| `gameValue`, `knowledgeXp` | int? | **computed**; if present must equal the formula unless `override` is set |
| `override` | `{gameValue?, knowledgeXp?, approvedBy}`? | requires `game-designer` approval |

Relation types: `is_a`, `part_of`, `uses`, `related_to`, `alternative_to`, `runs_on`, `implements`.

## 3. Difficulty rubric
- **novice** — known by most smartphone users / general public (CLOUD, EMAIL, PASSWORD, CPU).
- **intermediate** — known by tech-curious people and students (PYTHON, SQL, ROUTER, FIREWALL).
- **advanced** — known by practitioners (KAFKA, TERRAFORM, EMBEDDING, SOCKET).
- **expert** — specialist or long/complex (KUBERNETES, IDEMPOTENCY, BACKPROPAGATION).

## 4. Formulas (single source, implemented in `packages/lexicon/scripts/formulas.mjs`)
```
letterValue: A1 B3 C2 D3 E1 F4 G3 H3 I1 J8 K5 L2 M3 N1 O1 P2 Q8 R1 S1 T1 U2 V6 W5 X8 Y4 Z10   (letters-v1 = in-game values, GAME_RULES §3.1)
difficultyBonus = { novice: 0, intermediate: 4, advanced: 8, expert: 16 }
gameValue   = Σ letterValue(form) + 2 × max(0, len(form) − 5) + difficultyBonus[difficulty]
xpBase      = { novice: 10, intermediate: 25, advanced: 50, expert: 75 }
knowledgeXp = xpBase[difficulty] + min(len(form), 10)
```
Check: KUBERNETES (expert) → 17 + 10 + 16 = **43** game value, 75 + 10 = **85** Knowledge XP (vision V-05).

## 5. Graph invariants (validator-enforced)
No dangling relation targets · no self-relations · no duplicate (type, target) per term · no cycle in `is_a` ·
unique `id` and unique `form` · every category exists · `product` has `owner` · playable forms not in blocklist ·
definitions ≤ 160 chars in EN and FR.

## 6. Size targets & inflection policy (product owner decision, 2026-10-02)
- **Playtest target (E-1.5 stage 1):** ≥ 2,000 playable forms, of which ~20–25 % have 2–4 letters (≥ 350 with 3–4
  letters) and ≥ 30 are genuine two-letter tech forms (favour forms with vowels). Tracked as roadmap epic E-1.7.
- **Inflections accepted:** regular plurals and common inflected forms of a term (e.g. PODS, APIS) are playable.
  They are not separate terms: they resolve to the canonical term for metadata, Knowledge Cards and XP. The schema
  change (how inflected forms are declared and validated, incl. blocklist and uniqueness checks) is owned by
  `lexicon-engineer`; content by `lexicon-curator`.
- **Offensive-form removal from live play:** publish a new `lexiconVersion` behind a flag; matches already running
  finish on the version they pinned, so replays stay reproducible. No runtime deny-list.

## 7. Versioning
`lexiconVersion` = content hash of all data files. Published versions are immutable; matches pin a version.
