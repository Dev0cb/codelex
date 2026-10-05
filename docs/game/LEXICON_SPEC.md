# Lexicon Specification

Owners: `lexicon-engineer` (schema, validator) · `lexicon-curator` (content).
Schema: `packages/lexicon/schema/term.schema.json` (term-file **schema v2**) · Data: `packages/lexicon/data/` ·
Validate: `pnpm lexicon:validate [-- --report <path.json>]`.

## 1. Files
- `data/categories.json` — category registry (id, names EN/FR, colour token, icon).
- `data/terms/<category>.json` — `{ "schemaVersion": 2, "category": "<id>", "terms": [Term, …] }`. A term lives in
  the file of its **primary** category and may list secondary categories. Every term file must be at the current
  schema version (no mixed v1/v2 lexicon). `categories.json` has its own format version (still 1, unchanged).
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
| `inflections` | `{form, kind, confirmed?}`[]? | v2: curated playable inflected forms of this term (§2.1) |
| `tags` | string[]? | free tags (season packs, missions) |
| `gameValue`, `knowledgeXp` | int? | **computed**; if present must equal the formula unless `override` is set |
| `override` | `{gameValue?, knowledgeXp?, approvedBy}`? | requires `game-designer` approval |

Relation types: `is_a`, `part_of`, `uses`, `related_to`, `alternative_to`, `runs_on`, `implements`.

### 2.1 Inflections (schema v2, spec E-1.7)
`"inflections": [{ "form": "PODS", "kind": "plural" }]` on the canonical term. An inflection is a **playable
form** that resolves to its canonical term: it has no definition, display, difficulty, gameValue or knowledgeXp of
its own (all come from the term; spec E-1.7 D-2, D-3). Kinds: `plural | verb_s | verb_ed | verb_ing` — batch 1
authors `plural` only, verb kinds come from batch 2 on the curator's closed verb list (D-1). A string that is both a
plural and a verb form (COMMITS) is declared once, as `plural`. The kind is a label (stats, card line, analytics),
never a scoring input. Rules (validator, §5): matches `^[A-Z]{2,15}$` but is never two letters (two-letter
forms are canonical terms only), ≠ the term's own form, ≤ 4 per term, array sorted by form in code-unit order without duplicates, only on
`playable` terms with a `form`, never on `product` or `language` terms (D-6), not blocklisted, unique in the global
form namespace.

**Confirmed irregular forms (E-1.7 AC-14, sprint 3 P7).** An inflection that does not start with the term's form or
lacks its kind's suffix (§5 warnings) is either fixed or confirmed by the curator **as data**, on the entry itself:

```json
{ "form": "INDICES", "kind": "plural",
  "confirmed": { "approvedBy": "lexicon-curator", "reason": "Standard Latin plural of index, …" } }
```

`approvedBy` is non-empty, `reason` is 10..160 characters and says why the form is correct. A confirmed entry no
longer raises `NEEDS_REVIEW`; every other irregular entry, including a new irregular form added to the same term,
still does. `confirmed` on a regular form is an error, so a confirmation never outlives the irregularity it covers.
It is review metadata: excluded from `lexiconVersion` and `cardsVersion` (§7), so confirming never changes an
artefact. The field is optional, so schema v2 files without it stay valid (no `schemaVersion` bump).

## 3. Difficulty rubric
- **novice** — known by most smartphone users / general public (CLOUD, EMAIL, PASSWORD, CPU).
- **intermediate** — known by tech-curious people and students (PYTHON, SQL, ROUTER, FIREWALL).
- **advanced** — known by practitioners (KAFKA, TERRAFORM, EMBEDDING, SOCKET).
- **expert** — specialist or long/complex (KUBERNETES, IDEMPOTENCY, BACKPROPAGATION).

## 4. Formulas (single source, implemented in `packages/lexicon/scripts/formulas.mjs`)
```
letterValue: A1 B3 C2 D3 E1 F4 G3 H3 I1 J8 K5 L2 M3 N1 O1 P2 Q8 R1 S1 T1 U2 V6 W5 X8 Y4 Z10   (lexicon constant, frozen)
difficultyBonus = { novice: 0, intermediate: 4, advanced: 8, expert: 16 }
gameValue   = Σ letterValue(form) + 2 × max(0, len(form) − 5) + difficultyBonus[difficulty]
xpBase      = { novice: 10, intermediate: 25, advanced: 50, expert: 75 }
knowledgeXp = xpBase[difficulty] + min(len(form), 10)
```
Check: KUBERNETES (expert) → 17 + 10 + 16 = **43** game value, 75 + 10 = **85** Knowledge XP (vision V-05).

**`gameValue` is a lexicon value, not an in-game score (ADR-0014 §D5, T-6; 2026-10-04, sprint 3 L7).** The
`letterValue` and `difficultyBonus` tables above are **frozen lexicon constants**. They equal `letters-v1` and the
`engineRulesVersion` 1 term bonus (GAME_RULES §3.1, R-SCORE-003) by history only, and they do not follow later
rules versions: `engineRulesVersion` 2 uses `letters-v2` (BALANCE.md derivation record) and a lower term bonus
(0/2/4/8 or 0/3/6/12), and `gameValue` does not change. The engine scores from the match's rules version and never
reads `gameValue`. UI copy that states what a term scores in a match reads the engine values for the pinned
version, never `gameValue` (T-8). Consequences for versioning (§7): no rules version, draft or frozen, changes a
`gameValue`, the `lexiconVersion`, the `.clxi` index or `contentFormat`; batch-3 `lexiconVersion`
`e568477b5592a994` is unchanged by L7. Changing either table here is a lexicon change (every `gameValue` and the
`lexiconVersion` change) and needs `game-designer` approval.

## 5. Validator rules
**Errors (fail CI):**
- Files: `schemaVersion` equals the current schema version (2); the file `category` is registered; unknown fields
  rejected; required fields present.
- Graph: no dangling relation targets · no self-relations · no duplicate (type, target) per term · no cycle in `is_a`
  · unique `id` · every category exists and the first one equals the file category · `product` has `owner` ·
  definitions 10..160 chars in EN and FR · `gameValue`/`knowledgeXp` equal the formula unless an approved
  `override` exists.
- Schema types of every hashed or exported field, checked against `term.schema.json` by a zero-dependency checker:
  `playable` boolean; `override` an object with exactly `gameValue?`, `knowledgeXp?` (integers ≥ 0) and a non-empty
  `approvedBy`; `gameValue`/`knowledgeXp` integers ≥ 0; `tags`/`aliases` arrays of unique strings; `relations` an
  array of `{type (enum), target (string)}`; `sources` an array of `https://` strings.
- **One global form namespace:** canonical forms of playable terms and all inflection forms share one namespace
  across every file and category. A duplicate fails with one error naming the form and both term ids. When an
  inflection equals a canonical form (IDS, OSS, VMS), the **standalone term owns the string** and the inflection is
  the one reported, whatever the file order (D-5).
- Forms (canonical and inflections) match `^[A-Z]{2,15}$` and are not in any `data/blocklist/*.txt`. Blocklist
  lines are trimmed, `#` starts a comment, entries are folded (NFD, combining marks removed, uppercased: `écu` →
  `ECU`), and a line that does not match `^[A-Z]{2,15}$` after folding fails the load with its file and line.
- Inflections: entries are `{form, kind}` plus an optional `confirmed: {approvedBy, reason}` (§2.1; only on an
  irregular form, `approvedBy` non-empty, `reason` 10..160 chars); `kind` in the enum; form ≠ the term's form; no two-letter
  inflection (AC-15); ≤ 4 per term; sorted by form (code-unit order), no duplicates; owner term is `playable` with a
  `form`; owner kind is not `product` nor `language`. Inflections of an invalid owner are reported once and do not
  enter the namespace or the stats.

**Warnings (`NEEDS_REVIEW`, non-blocking, printed and in the report):**
- an inflection that does not start with the term's form (INDICES, MATRICES, PROXIES), unless `confirmed` (§2.1);
- a `plural`/`verb_s` not ending in S, `verb_ed` not ending in ED, `verb_ing` not ending in ING, unless `confirmed`;
- a `product`, `protocol` or `standard` term without `sources` (D-11; becomes an error once the seed has 0 warnings).

**Report (spec E-1.7 AC-7):** every run prints, and `--report <path>` writes as JSON: `lexiconVersion`,
`cardsVersion`, errors, warnings, form counts (canonical / inflections / total), counts by form length (2, 3, 4, 5–7,
8–10, 11–15; all forms), by primary category and by difficulty (canonical playable terms), by inflection kind, the
number of confirmed irregular inflections (`confirmedInflections`), and the list of two-letter forms.

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
Published versions are immutable; matches pin a version (ADR-0013 §D7). Both versions below are computed by
`packages/lexicon/scripts/canonical.mjs` and printed by the validator.

**`lexiconVersion`** `= hex(SHA-256(UTF-8(JCS(D))))[0..16)`, JCS = RFC 8785 (full, non-ASCII allowed). `D` is:

```
{
  "contentFormat": 1,                       // version of this field list; bump = every lexiconVersion changes
  "categories": [<category id>…],           // registry ids, sorted, unique
  "blocklist": [<FORM>…],                   // union of data/blocklist/*.txt, uppercased, sorted, unique
  "terms": [                                // every term (playable or not), sorted by id
    { "id", "playable", "kind", "difficulty",
      "categories": [<primary>, <secondary…sorted>],
      "form"?,                              // when present in the data
      "inflections": [{ "form", "kind" }…], // sorted by form; [] when absent
      "relations": [{ "type", "target" }…], // sorted by (type, target); [] when absent
      "tags": [<tag>…],                     // sorted, unique; [] when absent
      "gameValue"?, "knowledgeXp"?          // playable terms only: effective value (override, else formula)
    }…
  ]
}
```

Sorting is by UTF-16 code units (never locale). Consequences: the version is independent of file names and
layout, of how terms are split across files, of key order, whitespace, CRLF/LF, and of the order of tags,
relations, secondary categories and blocklist lines; an absent optional array equals `[]`; writing the computed
`gameValue`/`knowledgeXp` explicitly equals omitting them. **Excluded** (display-only, never changes the version):
`definitions`, `display`, `owner`, `sources`, `aliases`, `override.approvedBy`, inflection `confirmed`, category names, icons and colour
tokens, and `schemaVersion` (a pure format migration such as v1 → v2 keeps the version).

**`cardsVersion`** — same construction over the display-only document
`{ contentFormat, categories: [registry entries…] sorted by id, terms: [{ id, display, definitions, owner?, aliases (sorted),
sources (sorted) }] sorted by id }`; it identifies the Knowledge Cards artefact, so a definition fix changes
`cardsVersion` only and never invalidates replays or pins.

Property tests (`packages/lexicon/test/canonical.test.mjs`) check invariance to all the layout changes above and
that every playable field changes the version while every display field does not.

**Profiles and `definitionHash`** (lexicon-index note §4.2). An index artefact is identified by (`lexiconVersion`,
profile id, `definitionHash`), where `definitionHash = hex(SHA-256(UTF-8(JCS(P))))[0..16)` and `P` is the
canonical profile definition `{ id, kind, include, exclude?, inflections? }` (`canonicalProfileDefinition` in
`canonical.mjs`). The profile option **`inflections: "all" | "none"`** (E-1.7 D-14) is build-time only:
`all` (the default) keeps every declared inflection; `none` builds canonical forms only, with the same terms,
metadata and relations. `all` is omitted from `P`, so spelling it out does not change the hash; any other value
is refused. There is no runtime switch: the same `lexiconVersion` under another option is another profile.
Profiles built by `build:index`: `global-ranked` (all; the only one bundled or played) and
`global-no-inflections` (none; simulation only, AC-20).

## 8. Schema versions and migrations
| Term-file `schemaVersion` | Change | Migration |
|---|---|---|
| 1 | initial | — |
| 2 (2026-10-02, sprint L1) | optional `inflections` (§2.1); validator rules of §5; canonical `lexiconVersion` (§7) | `node packages/lexicon/scripts/migrate-v1-to-v2.mjs` — bumps `schemaVersion` only (idempotent); playable set and `lexiconVersion` unchanged |
