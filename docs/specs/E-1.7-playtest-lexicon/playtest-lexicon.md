# Playtest lexicon: ≥ 2,000 playable forms and curated inflections

- Epic: E-1.7 (feeds E-1.5 playtest Stage 1, E-1.3 bots, E-1.6 balance; depends on E-1.2) · Vision refs: V-04, V-05,
  V-13 · Status: Ready for design
- Owner: product-strategist · Last update: 2026-10-02
- Sprint: `docs/sprints/2026-10-02-phase1-engine-core.md` task D2 (unblocks L1, L2, C1).
- Next reviews: `game-designer` (scoring and rule amendments, confirmations C-GD-1..5), `lexicon-curator` (content
  plan, two-letter pool, confirmations C-LC-1..5), `lexicon-engineer` (schema v2, validator), `solution-architect`
  (the change crosses `packages/lexicon`, `packages/game-engine`, `packages/bots`, `apps/mobile`), FYI
  `data-analyst`, `ux-ui-designer`, `ai-engineer`. `privacy-compliance` is not required (no personal data, see below).

## Problem

Phase 1 must prove the fun (ROADMAP Phase 1). The playtest (E-1.5) runs Classic 15×15 against the lexicon bundled
on the phone, and the lexicon is the only vocabulary the player and the bots can use (R-TURN-003). Today it is far
too thin:

| Measure (seed on 2026-10-02, measured with a grep over `packages/lexicon/data/terms`) | Today | Playtest need |
|---|---|---|
| Playable forms | 310 (319 terms) | ≥ 2,000 (product owner decision, `docs/game/LEXICON_SPEC.md` §6) |
| Two-letter forms | 6 (AI, ML, CD, CI, IP, GO) | ≥ 30 genuine tech forms |
| 3–4-letter forms | 83 (42 + 41) | ≥ 350 |
| 5–7 / 8–10 / 11–15 letters | 117 / 80 / 24 | see distribution target |
| Inflected forms (PODS, APIS) | 0 — not representable in schema v1 | plurals supported |
| Blocklists (`en.txt`, `fr.txt`) | empty (header only) | vetted before batch 1 merges |

Evidence (game-designer review of E-1.5, R-1): with 6 two-letter forms, parallel plays and hooks are nearly
impossible, the board becomes a sparse crossword, premiums go unreachable and bots often have no legal move late in
the game; below ~1,000 forms the same 40–50 acronyms dominate every game, and repetition kills "would play again".
BALANCE.md sets the measured fallback: if the 15×15 simulation shows > 15 % turns with no legal word, > 10 %
scoreless endings or top-20 terms > 40 % of words played, the playtest falls back to an 11×11 board. A rich, honest
lexicon is the cheapest way to keep full Classic.

## Target players & context

- Internal playtesters (adults, ≥ 1/3 non-engineers, EN and FR speakers in France and Senegal; E-1.5 Q-2) standing in
  for casual tech-curious players and competitive word-game players.
- Device: low-end Android, offline. The lexicon ships as a bundled artefact (lexicon-index note §3.4–3.6); size and
  lookup budgets of E-1.2 apply.
- Locale: board forms are A–Z (R-CORE-003); every canonical term has EN and FR definitions; UI follows the device
  locale.
- Indirect users: `ai-engineer` (bots generate moves from the index), `game-designer` (simulation), `lexicon-curator`
  (authoring at scale).

## User stories

1. As a player, I want most racks to offer at least one real tech word, so that I spend my turn thinking about
   strategy, not passing.
2. As a player, I want short genuine tech terms (OS, UI, VM, DB) to work as hooks and parallel plays, so that the
   board opens up and premiums are reachable.
3. As a player, I want the plural of a term I know (PODS, APIS, BUGS) to be accepted, so that the game does not
   reject words that obviously make sense.
4. As a player, I want a plural to earn the same term bonus as its term and to open the same Knowledge Card, so that
   it never feels like a second-class word.
5. As a non-engineer playtester, I want plenty of novice and intermediate terms in every category, so that I can win
   against Beginner Bot without being an expert.
6. As a player, I want to never see an offensive word accepted or displayed, so that I trust the game.
7. As the lexicon curator, I want inflections declared next to their term and checked by the validator, so that I
   can add hundreds of forms safely without generating junk like HTTPSES.
8. As the game designer, I want simulation metrics per lexicon batch, so that I can decide on evidence whether full
   Classic is fun enough or the 11×11 fallback is needed.

## Acceptance criteria

"Validator" = `pnpm lexicon:validate`. "Index" = the `LexiconIndex` of E-1.2 (reference implementation in this
sprint, binary DAWG from L4). "Form" = a playable string; "term" = the canonical entry holding metadata.

### Schema v2 and validator (task L1, owner `lexicon-engineer`)

- **AC-1 Inflections declared on the term.** Given a term file with `schemaVersion: 2` and a playable term
  `{ id: "pod", form: "POD", …, inflections: [{ form: "PODS", kind: "plural" }] }`, When the validator runs, Then it
  passes, PODS counts as one playable form, and stats report canonical forms, inflection forms and total forms
  separately.
- **AC-2 Migration without change of the playable set.** Given the seed migrated to schema v2 (every file
  `schemaVersion: 2`, no inflections yet), When the validator runs, Then it is green and the playable form set equals
  the v1 set (310 forms) exactly. The validator rejects mixed v1/v2 files after the migration PR.
- **AC-3 Global uniqueness.** Given an inflection whose form equals any canonical form or any other inflection in the
  lexicon (any file, any category), When the validator runs, Then it fails with one error naming the form and both
  owning term ids. Canonical forms and inflections share one namespace.
- **AC-4 Shape rules.** Given an inflection, Then the validator fails if: the form does not match `^[A-Z]{2,15}$`; the
  form equals the term's own form; `kind` is not in the v2 enum (D-1); the owning term is `playable: false` or has
  no `form`; the owning term has `kind` `product` or `language` (D-6); the array has duplicate forms, is not sorted
  by form (code-unit order), or has more than 4 entries.
- **AC-5 Blocklist on every form.** Given a form (canonical or inflection) present in any `data/blocklist/*.txt`, When
  the validator runs, Then it fails naming the form and term id; the index build refuses the data and no artefact
  section contains a blocklisted form (lexicon-index note §4.4, T-BLOCKLIST extended to inflections).
- **AC-6 Review warnings, non-blocking.** Given an inflection that does not start with the canonical form (INDICES,
  MATRICES, PROXIES) or a `plural` that does not end in S, When the validator runs, Then it passes and prints a
  `NEEDS_REVIEW` warning listing the form, so the curator confirms irregular forms explicitly. Given a `product`,
  `protocol` or `standard` term without `sources`, Then a `NEEDS_REVIEW` warning is printed (D-11).
- **AC-7 Report for batch gates.** Given any validator run, Then it prints (and writes as JSON with
  `--report <path>`) counts by form length (2, 3, 4, 5–7, 8–10, 11–15), by primary category, by difficulty, by
  inflection kind, the full list of two-letter forms, and the `lexiconVersion`. ASSUMPTION: the flag name is the
  engineer's choice; the content of the report is the requirement.

### Index and engine (tasks L2, L3, E3; owners `lexicon-engineer`, `game-engine-engineer`)

- **AC-8 Form → term resolution.** Given the index built from data with POD and its inflection PODS, When the engine
  looks up "PODS", Then `has("PODS")` is true, the lookup returns a `FormRef` whose term is POD (`TermRef`), the
  index `size` counts forms (canonical + inflections), and the term metadata (id `pod`, difficulty, categories,
  relations, gameValue, knowledgeXp) is POD's. T-COMPLETE, T-SOUND and T-ORACLE cover inflections.
- **AC-9 Scoring of an inflected form.** Given a placement whose main word is PODS, When the engine scores it, Then the
  word base is computed on the four tiles P-O-D-S like any word (R-SCORE-001), the term bonus is POD's difficulty
  bonus (R-SCORE-003), cross-words that are inflections are treated the same way, and the `ScoreBreakdown` entry
  carries both the played form (PODS) and the canonical term id (`pod`). Golden case required in
  `docs/game/RULE_PROPERTIES.md` (owner `game-designer`).
- **AC-10 Chain bonus through the canonical term.** Given a player's previous main word KUBERNETES and a new main word
  PODS, When scored, Then the chain link is evaluated between `kubernetes` and `pod` (R-SCORE-005). Given the
  previous main word POD and the new main word PODS by the same player, Then it is the same term repeated — not a
  link (R-SCORE-005 d), so R-SCORE-005 c applies.
- **AC-11 Bots see inflections like any form.** Given the index, When a bot generates moves, Then inflections are
  generated and scored like canonical forms, and personality vocabulary filters (e.g. Beginner avoids expert terms)
  use the canonical term's difficulty.

### Player-facing surfaces (E-1.5 consumers; owners `mobile-engineer`, `ux-ui-designer`)

- **AC-12 Move log, summary and Knowledge Card.** Given PODS was played, Then the move log shows PODS as played; the
  summary term chips are deduplicated by canonical term (POD and PODS played → one chip "Pod"); "New to you" counts
  canonical terms; tapping the chip opens POD's Knowledge Card with a secondary line "Played as PODS" (EN) / "Joué
  sous la forme PODS" (FR). Rejections keep the E-1.5 copy ("Not in the CODELEX lexicon: PODZ").

### Content (tasks C1 then batches 2–3; owner `lexicon-curator`)

- **AC-13 Batch 1 (this sprint).** Given batch 1 merged, When the validator runs, Then it is green and the report
  shows: ≥ 800 playable forms of which ≥ 550 canonical; ≥ 30 two-letter forms; ≥ 160 forms of 3–4 letters; 2–4-letter
  forms ≥ 20 % of all forms; every one of the 9 categories holds 8–16 % of canonical playable terms; every canonical
  term has original EN and FR definitions (10–160 chars).
- **AC-14 Playtest lexicon (end of batch 3).** Given batch 3 merged, Then: ≥ 2,000 playable forms, of which
  ≥ 1,300 canonical and inflections ≤ 35 % of forms; ≥ 30 two-letter forms (target 35+); ≥ 350 forms of 3–4
  letters; 2–4-letter forms 20–25 %; 11–15-letter forms ≤ 12 %; category share 8–16 % each; difficulty mix of
  canonical playable terms within the D-9 bands; 0 validator errors and 0 open `NEEDS_REVIEW` items.
- **AC-15 Two-letter honesty.** Given any two-letter form, Then it is a canonical term (never an inflection) whose
  EN and FR definitions spell out what it stands for, it has ≥ 1 `sources` URL, it passes the two-letter checklist
  (D-7), and no two-letter form is accepted only because it is an English or French function word.
- **AC-16 Trademarks.** Given a term of `kind: product`, Then it has an `owner` (legal holder), no inflections, a
  neutral nominative definition that implies no endorsement, and the `display` uses the holder's official
  capitalisation.
- **AC-17 Offensive collisions.** Given batch 1 is proposed, Then `data/blocklist/en.txt` and `fr.txt` are populated
  from a vetted source with an approved licence (D-12) plus a manual list, and every form of 2–4 letters (canonical
  and inflections) has been reviewed by the curator for offensive readings in EN and FR (checklist recorded in the
  batch PR).

### Versioning, rollout and measurement

- **AC-18 Pinning and replay.** Given a match created with `lexiconVersion` V and profile P, When a new lexicon V′ is
  bundled in a later build, Then a replay of the saved match against V reproduces the same state hash, and the
  engine rejects an index whose version or profile differs from the match header (`LEXICON_MISMATCH`, lexicon-index
  note §2.2). On the phone, a saved match from another version follows the E-1.5 `version_mismatch` state.
- **AC-19 Removal of a form after publication.** Given a published form must be removed (offensive, wrong), When the
  curator adds it to the blocklist, Then the validator fails until the form is removed from data, the result is a
  new `lexiconVersion` shipped like any version (flag / build), matches pinned to the old version finish on it, and
  no runtime deny-list exists.
- **AC-20 Simulation readout per batch.** Given a batch is merged and the E-1.3 simulator exists, When it runs a
  fixed seed set on the current lexicon with profile variants "with inflections" and "without inflections" (D-14),
  Then a readout records the KPI table below for both variants and is linked from the sprint file.
- **AC-21 Suggestion helper never writes data.** Given the optional inflection helper script, When it runs, Then it
  only prints deterministic candidates (regular -S / -ES / -IES rules; skips `product` and `language` terms, mass
  nouns tagged by the curator, and any collision with an existing form or blocklist entry) for curator review, and
  it never edits `packages/lexicon/data`.

## Non-goals

- Rule-generated inflections at build or run time (decided: rules produce junk on acronyms such as HTTPS).
- Verb forms in batch 1 (enum allows them; content from batch 2 only on a closed verb list, D-1).
- French or other locale-specific playable forms (IA, BDD, LOGICIEL): forms stay the international tech vocabulary
  in v2 (D-8); locale profiles are a Phase 2+ question.
- Per-inflection definitions, display strings, difficulty, gameValue or knowledgeXp (all resolve to the term).
- Comparatives, compounds, prefixes (SUBNETS yes as a plural of SUBNET; MICROSERVICES only as its own term).
- Changing letter values or the bag (frozen by `engineRulesVersion` in D3); re-deriving them from the new lexicon is
  E-1.6.
- Season packs, org-restricted dictionaries, `services/knowledge` publishing (Phase 2+).
- Runtime deny-lists or any runtime flag that changes the playable set without a new `lexiconVersion`.

## UX

No new screen. Two surface rules for the E-1.5 design spec (`ux-ui-designer`, U1): the played form appears as played
on the board and in the move log; summary chips, "New to you" and Knowledge Cards work on canonical terms with a
"Played as {form}" / "Joué sous la forme {form}" line when the played form is an inflection (AC-12). Copy keys are
proposed for `packages/i18n`: `card.played_as` (EN "Played as {form}", FR "Joué sous la forme {form}"). No strings
are added by the lexicon itself beyond definitions.

## Rules impact

Requests to `game-designer` (rules are amended in `docs/game/GAME_RULES.md`, not here):

1. **Amend R-CORE-003** — "A playable form is the `form` of a playable term or one of its declared inflections,
   present in the match's lexicon profile." (R-TURN-003 then needs no change.)
2. **New rule (proposed R-CORE-006) "Form resolution"** — every term-dependent rule resolves a played form to its
   canonical term: R-SCORE-003 (term bonus), R-SCORE-005 (chain; an inflection of the same term is "the same term
   repeated"), R-BOARD-003 (tech-square categories), R-POW-COMPILE ("advanced+ term"), R-MODE-ARENA-002 (category
   effects), knowledge XP and "terms discovered".
3. **R-BAG-001 / BALANCE.md** — letter frequency for derivation is counted over all playable forms including
   inflections (they are what players and bots play). Phase 1 values stay frozen by `engineRulesVersion` 1 (D3), so
   this only affects E-1.6 calibration.
4. **Golden cases** in `docs/game/RULE_PROPERTIES.md`: plural main word scored with the canonical term bonus; hook
   (one S added to an existing word) re-scoring the whole cross-word including the term bonus; chain POD → PODS not a
   link.

No `engineRulesVersion` bump is needed for content changes: the lexicon is pinned by `lexiconVersion`. The engine
change to resolve forms to terms is part of E3 before any replay is published.

## Analytics & KPIs

The lexicon emits **no runtime analytics events** (it is static, bundled data). Measurement comes from the validator
report (AC-7), the E-1.3/E-1.6 simulator (AC-20) and, during the playtest, the existing E-1.5 events.

### KPIs

| KPI | Type | Target | Source |
|---|---|---|---|
| Turns with no legal PlaceWord (bot, 15×15 Classic, equal bots) | **Primary** | ≤ 15 % at batch 3 (BALANCE.md fallback threshold); trend reported at batches 1–2 | E-1.3 simulator / E-1.6 |
| Matches ending on scoreless turns (R-TURN-004) | Guardrail | ≤ 10 % at batch 3 | simulator |
| Top-20 terms share of words played | Guardrail | ≤ 40 % at batch 3 | simulator |
| Validator errors on `main` | Guardrail | 0, always | CI |
| Offensive or wrong-term content reported in playtest | Guardrail | 0 offensive; any report → new version (AC-19) | debrief, E-1.5 halt criteria |
| Index size compressed / load on reference device | Guardrail | ≤ 0.3 MB / < 100 ms at 2,000 forms (lexicon-index note §5) | L4 size gate, T10 |
| Inflection share of words played | Secondary | baseline (expect 10–25 %) | simulator; playtest via `form_kind` (below) |
| Term-bonus points from hooked inflections (single tile added) | Secondary | baseline; investigate if > 10 % of all term-bonus points | simulator |
| Lift from inflections (no-legal-word rate, with vs without) | Secondary | baseline; justifies D-1 | AC-20 variants |
| Rejected attempts per player turn (playtest) | Secondary | median ≤ 1.0 (E-1.5 guardrail) | `word_rejected` |
| Distribution targets (AC-13, AC-14) | Batch gate | as stated | validator report |

### Events

No new event. One property proposed to `data-analyst` for the E-1.5 catalogue proposal (not edited here):
`bot_word_played.form_kind` ∈ `canonical | plural | verb_s | verb_ed | verb_ing`; `term_id` stays the canonical id.
No played string is added (E-1.5 Q-8 spirit: avoid free text).

## Flags & rollout

- **No runtime flag changes the playable set.** A runtime toggle of inflections would make the same
  `lexiconVersion` mean two different word sets and break replay determinism (R-CORE-005). The "switch" is
  build-time: a lexicon profile option `inflections: all | none` (part of the profile definition and of its
  `definitionHash`; lexicon-index note §4.2). Profiles shipped: `global` (all) for the playtest; `global-no-inflections`
  for simulation only (AC-20). Owner of the profile format: `lexicon-engineer` (T1).
- **Rollout = a new `lexiconVersion` in a new build.** Each playtest build bundles exactly one `lexiconVersion`;
  matches pin it at creation (R-CORE-001); in-progress matches from an older build follow the E-1.5
  `version_mismatch` state. Kill switch for a bad lexicon = `play_vs_bot.enabled` (E-1.5) plus a fix build.
- **Halt criteria:** any offensive form accepted or displayed; any wrong canonical resolution (card of the wrong
  term); validator red on `main`; index size or load over budget.

### Thin slices (each independently shippable and measurable)

| Slice | Content | Task | Ships behind | Measure |
|---|---|---|---|---|
| S1 | Schema v2 + validator rules + migration (no inflections) + report | L1 | data/schema version | AC-1..7; playable set unchanged (310) |
| S2 | `FormRef`/`TermRef` split in index types and reference index | L2, L3 | index interface | T-COMPLETE/T-SOUND/T-ORACLE incl. fixture inflections |
| S3 | Engine resolution + golden cases | E3 | `engineRulesVersion` 1 (before any published replay) | AC-9, AC-10 |
| S4 | Blocklists populated + content batch 1 (≥ 800 forms, ≥ 30 two-letter) | C1 | new `lexiconVersion` | AC-13, AC-15..17 |
| S5 | Simulator readout with/without inflections on batch 1 (stretch) | B1 | profile variants | AC-20 KPIs |
| S6 | Batch 2 (≥ 1,400 forms; verb forms on closed list) | next sprint | new `lexiconVersion` | report + simulator |
| S7 | Batch 3 (≥ 2,000 forms) → gate for E-1.6 calibration and playtest Stage 1 | next sprint +1 | new `lexiconVersion` | AC-14, primary KPI |

## Privacy, security, monetisation notes

- **Privacy:** no personal data. Lexicon data holds terms, definitions and public source URLs only. The
  `override.approvedBy` field must hold an agent role or team name, never a person's name or email.
- **Security / integrity:** the lexicon is public data; validity is enforced by the engine (server-side from Phase 2).
  Build determinism and blocklist enforcement are covered by T-DETERMINISM and T-BLOCKLIST.
- **Monetisation:** no word, form or lexicon access is ever purchasable in competitive play (no pay-to-win). Future
  paid content (season packs, org dictionaries) must never change the ranked profile; flag any such proposal to
  `monetization-liveops` and `game-designer`.
- **Licences and copyright:** definitions are original text (never copied from Wikipedia, vendor docs or
  dictionaries); `sources` are for verification only. Any third-party dataset used by tooling (blocklist source,
  frequency lists for the helper) must be under an allowlisted licence (`docs/standards/ENGINEERING.md`: MIT,
  Apache-2.0, BSD, ISC, MPL-2.0, BlueOak-1.0.0); anything else (CC-BY, CC-BY-SA, ODbL, GPL) needs human approval.
  No bulk extraction from a single third-party glossary (EU database right).

## Dependencies & risks

### Dependencies

| Dependency | Needed for | Status |
|---|---|---|
| L1 schema v2 + canonical `lexiconVersion` + profiles | S1, AC-1..7, D-14 | this sprint, depends on this spec |
| L2/L3 `@codelex/lexicon/index` types and reference index | AC-8 | this sprint |
| E3 engine scoring, D3 letter table | AC-9, AC-10 | this sprint |
| L4 DAWG + size gate | size guardrail | this sprint |
| B1 simulator (stretch) / E-1.6 | primary KPI | stretch this sprint, required before playtest Stage 1 |
| U1 E-1.5 design spec | AC-12 | this sprint (parallel) |
| Blocklist source with approved licence | AC-17 | human follow-up H-1 if not allowlisted |

### Risks

| ID | Risk | L | I | Mitigation |
|---|---|---|---|---|
| R-1 | Curation throughput: ~1,000 new terms with EN/FR definitions in ~3 sprints | High | High | Batches of ≤ 200 terms per PR (curator rule), parallel PRs per category, helper script for inflections, short terms first; slip → playtest Stage 1 waits (no lowering of 2,000 without a simulator readout) |
| R-2 | Padding with obscure acronyms to hit counts (quality, "homework" feel) | Medium | High | Difficulty bands (D-9), inflection cap 35 %, two-letter checklist, curator spot-review of 10 % of each batch by a second pass |
| R-3 | Hook exploit: adding S to a long expert term re-scores it with +16 | Medium | Medium | Same as standard word-game hooks; measured (secondary KPI); game-designer may later cap term bonus to the main word or once per term per match (C-GD-2) |
| R-4 | S-tile inflation: plurals raise S frequency and make S overpowered | Medium | Medium | Phase 1 bag frozen (D3); E-1.6 measures S usage and value; counted in R-BAG-001 derivation |
| R-5 | Offensive collision in EN or FR, notably 2–4-letter acronyms | Medium | High | Blocklists + manual 2–4-letter review (AC-17), removal by new version (AC-19), halt criterion |
| R-6 | Trademark misuse (plurals or verbs of marks, implied endorsement) | Low | Medium | No inflections on products (D-6), `owner` required, LEGAL_REVIEW before public release |
| R-7 | Uniqueness conflicts (IDS = intrusion detection system vs plural of ID) | High | Low | Standalone term owns the string (D-5); validator error names both owners |
| R-8 | FR players disadvantaged by English-only forms | Medium | Medium | Forms are the international tech vocabulary FR speakers use too; FR definitions everywhere; debrief question; locale profiles later (D-8) |
| R-9 | Schema v2 touches every lexicon consumer | Medium | Medium | `FormRef`/`TermRef` split done in L2 now, not later (sprint risk list) |

## Decisions (formerly open questions)

Decided 2026-10-02 by `product-strategist` under delegation from the product owner ("take the best decisions for
me"), after reading LEXICON_SPEC, GAME_RULES v0.2, BALANCE, the lexicon-index note and the E-1.5 decisions. Every
decision is reversible (data and schema minor changes), except where noted.

- **D-1 Inflection kinds in schema v2:** enum `plural | verb_s | verb_ed | verb_ing`. **Batch 1 authors `plural`
  only**; verb kinds are authored from batch 2 on a closed list of ≤ 60 common tech verbs owned by the curator
  (DEPLOY, COMMIT, MERGE, PUSH, PULL, FORK, CACHE, HASH, PING, BOOT, COMPILE, DEBUG, ENCRYPT, PATCH, PARSE, ROUTE,
  SCALE, LOG…). Why: plurals are the cheapest and biggest playability lever (S hooks), very low curation risk; -ED and
  -ING forms add 6–9-letter words that help Full Stack (R-SCORE-004) but need judgement, so they come after the
  batch-1 simulator readout. A string that is both a plural and a verb form (COMMITS) is listed once with the noun
  reading (`plural`). The kind is a label (stats, card line, analytics), never a scoring input. Adding a kind later is
  a schema minor change.
  ICE: plurals — impact high × confidence high ÷ effort low; verbs — impact medium × confidence medium ÷ effort
  medium → deferred one batch.
- **D-2 Scoring of inflected forms:** letters score as placed (no special case); the term bonus (R-SCORE-003) is the
  canonical term's; chain, tech squares, Compile charge, Arena effects resolve to the canonical term. Rejected
  alternative: no term bonus for inflections (feels second-class, adds a rule, contradicts the sprint decision "term
  bonus and XP resolve to the canonical term"). **Needs `game-designer` confirmation (C-GD-1).**
- **D-3 Knowledge and progression:** an inflection has no definition, difficulty, gameValue or knowledgeXp of its
  own; Knowledge Card, "New to you", future XP and "terms discovered" count canonical terms once (AC-12).
- **D-4 Counting:** "playable forms" = distinct playable strings (canonical + inflections). Honesty guard: ≥ 1,300
  canonical terms and inflections ≤ 35 % of forms at 2,000 (≥ 550 canonical at batch 1).
- **D-5 Uniqueness conflicts:** one global namespace; when a plural equals a standalone term (IDS, OSS, CIS, VMS),
  the standalone term owns the string and the other term does not declare it. A form never resolves to two terms.
- **D-6 Which terms may have inflections:** `concept`, `acronym`, `tool`, `protocol`, `standard` — curator judgement
  (countable nouns only: PODS, APIS, CPUS, PROXIES, INDEXES; no MALWARES, no HTTPSES). Never `product` (trademark
  practice: marks are not pluralised or verbed) nor `language` (JAVAS). Validator-enforced (AC-4). Max 4 per term.
  Irregular plurals (INDICES, MATRICES, VERTICES) are allowed with a `NEEDS_REVIEW` confirmation.
- **D-7 Two-letter forms, honestly:** only canonical terms that are widely used tech abbreviations or concepts, each
  with a definition that spells out the expansion and ≥ 1 source; never an inflection, never accepted only because it
  is a common EN/FR word; offensive readings in EN/FR excluded. Units (KB, GB) and logic/control concepts (OR, IF)
  are allowed because they are first-class tech concepts. Candidate pool for batch 1 (curator confirms, C-LC-1):

  | Status | Forms |
  |---|---|
  | Existing (6) | AI, ML, CD, CI, IP, GO |
  | Pool A (35) — vowel-bearing first | OS, UI, UX, IO, IT, ID, IF, OR, AR, AS, AP, AV, AZ, OT, QA, DB, DC, DL, PC, PK, FK, PR, VM, VR, JS, TS, CS, CV, NN, RL, LB, KB, MB, GB, TB |
  | Pool B (review) | PB, HZ, XR, RX, TX, AD (product, Microsoft; ambiguous) |

  Target ≥ 35 two-letter forms at batch 1 (margin over the ≥ 30 gate). ASSUMPTION: CV (computer vision) and IT are
  acceptable despite their everyday meanings, because the tech meaning is primary in this context.
- **D-8 Language of forms:** playable forms are the international tech vocabulary (mostly English-origin acronyms
  and words) for both locales; no French-only forms in v2 (IA, BDD). Revisit with playtest debrief data (Phase 2).
- **D-9 Difficulty bands (canonical playable terms):** novice 20–30 %, intermediate 30–40 %, advanced 20–30 %,
  expert ≤ 15 %. Today (319 terms): 22 % / 33 % / 32 % / 13 %. New short forms skew novice/intermediate, which
  serves the ≥ 1/3 non-engineer cohort and Beginner Bot's vocabulary filter.
- **D-10 Distribution targets (all forms):** 2 letters ≥ 30 (target 35+); 3–4 letters ≥ 350 at 2,000 (≥ 160 at
  batch 1; acronym plurals such as APIS, CPUS, URLS, VPNS feed this bucket); 2–4 letters 20–25 %; 5–7 letters ≈ 35–45 %;
  8–10 letters ≈ 20–30 %; 11–15 letters ≤ 12 %. Category balance: each of the 9 categories 8–16 % of canonical terms
  at every batch (Cloud, the smallest today with 25, is prioritised in batch 1). Only 2-letter count and the
  category/2–4 gates are hard; the other buckets are steering targets.
- **D-11 Content rules per term:** original EN and FR definitions (10–160 chars) for every canonical term; `sources`
  ≥ 1 official URL for `product`, `protocol`, `standard` (warning in v2, error once the seed has 0 warnings);
  `product` needs `owner` and official capitalisation in `display`; difficulty per the LEXICON_SPEC rubric; relations
  to existing terms encouraged (chain bonus needs a connected graph; target ≥ 1 relation for ≥ 80 % of new terms).
- **D-12 Blocklist:** EN and FR lists populated before batch 1 merges, from a vetted dataset under an allowlisted
  licence, plus a manual list of abbreviation slurs and FR/EN offensive collisions of 2–4 letters; the validator
  checks canonical forms and inflections; removal after publication = new `lexiconVersion` (no runtime deny-list,
  product owner decision 2026-10-02). ASSUMPTION: a suitable allowlisted dataset exists; otherwise H-1.
- **D-13 Inflection array order:** sorted by form; enforced by the validator so diffs and the canonical
  `lexiconVersion` stay stable regardless of authoring order.
- **D-14 No runtime flag for inflections:** build-time profile option `inflections: all | none`, part of the profile
  `definitionHash`; the no-inflection profile exists for simulation only (AC-20).
- **D-15 Helper script:** optional, owned by `lexicon-engineer`, suggestion-only (AC-21); not required for C1.
- **D-16 Batch plan:** batch 1 (this sprint, C1): ≥ 800 forms / ≥ 550 canonical / ≥ 30 two-letter, plurals only;
  batch 2 (next sprint): ≥ 1,400 forms, verb kinds on the closed list; batch 3 (sprint after): ≥ 2,000 forms /
  ≥ 1,300 canonical. Each batch is split into category PRs of ≤ 200 terms. Playtest Stage 1 is gated on batch 3 plus
  the primary KPI, not on the calendar.
- **D-17 Letter derivation includes inflections** (Rules impact 3); Phase 1 values stay frozen by D3.

## Confirmations requested (non-blocking for design)

- `game-designer`:
  - C-GD-1 D-2 (canonical term bonus on inflections).
  - C-GD-2 R-3: accept full term bonus on hooked cross-words for the playtest, with the secondary KPI as tripwire.
  - C-GD-3 Rule text for the R-CORE-003 amendment and the new form-resolution rule (proposed R-CORE-006).
  - C-GD-4 D-17 (letter frequency counted over inflections for E-1.6).
  - C-GD-5 D-7 inclusion of OR / IF and units; D-1 deferral of verb forms to batch 2.
- `lexicon-curator`:
  - C-LC-1 Final two-letter list from pool A/B.
  - C-LC-2 Feasibility of batch sizes (D-16) and category plan.
  - C-LC-3 Closed verb list for batch 2.
  - C-LC-4 Blocklist source choice and its licence.
  - C-LC-5 Policy for mass nouns (no plural) and for D-5 conflicts in the existing seed.

### Curator answers (C-LC-1..5)

Decided 2026-10-02 by `lexicon-curator` under the product owner's delegation, with content sub-batch **1a**
(`feat/lexicon-batch-1a`). All reversible by a new `lexiconVersion`.

- **C-LC-1 Two-letter list: 37 forms (gate ≥ 30, target 35+).** AI, ML, CD, CI, IP, GO (seed) + AP, AR, AS, BI,
  CS, DB, DC, DL, ES, GB, ID, IF, IO, IT, JS, KB, MB, NN, OR, OS, OT, PC, PR, QA, RL, TB, TS, UI, UX, VM, VR.
  Every one is a canonical term with its expansion in the EN and FR definitions and ≥ 1 source (AC-15). VM and OS are
  the existing `virtual-machine` and `operating-system` terms made playable (no duplicate concept); DB, JS, TS, NN,
  RL and DC are abbreviation terms `related_to` their long-form term. GAME_RULES C-GD-5 checks: vowel-bearing
  19 / 37 (AI, AP, AR, AS, BI, CI, ES, GO, ID, IF, IO, IP, IT, OR, OS, OT, QA, UI, UX) ≥ half; forms with a letter
  worth ≥ 5 = 6 (JS, KB, QA, UX, VM, VR) ≤ 6; OR and IF as logic concepts, KB/MB/GB/TB as data units; no form admitted
  only as a function word (IT = information technology, AS = autonomous system, IF = conditional statement).
  Not taken: AV, AZ, PK, FK, CV (would exceed the high-value-letter cap); LB (weak usage, ambiguous with the pound);
  pool B: HZ, XR, RX, TX (cap), PB (consonant-only, low usage; candidate later), AD (product, ambiguous). Added
  outside the pool: BI (business intelligence) and ES (ECMAScript), both vowel-bearing.
- **C-LC-2 Batch sizes and category plan: feasible, with batch 1 split into category-mixed PRs of ≤ 200 terms.**
  1a (this PR): 172 new canonical terms (29 two-letter, Cloud first: Cloud 25 → 65 playable terms), 2 terms made
  playable, 233 curated plurals, sources on all 25 previously unsourced product/protocol/standard terms. Result: 717
  forms = 484 canonical + 233 inflections. 1b (next PR, ~100–120 terms, canonical-heavy) closes the ≥ 800 forms /
  ≥ 550 canonical gate. Steering for 1b and later: the advanced share sits at the D-9 ceiling (30.0 %) and the
  inflection share at 32.5 % (cap 35 %), so new content skews novice/intermediate and canonical; every category is
  kept at 8–16 % per PR (today 10.1–13.4 %). Batches 2–3 (≈ +800 canonical over two sprints) need 4–5 PRs of
  ≤ 200 terms in parallel by category: feasible, R-1 stays the main schedule risk.
  **1b (2026-10-03, authored by the orchestrator while the curator agent was unavailable; curator second pass
  done the same day, sprint 2 R2: 15 terms corrected — difficulty, definitions, relations, one source — 6 irregular
  plurals confirmed):** 70 new generic canonical terms (no products, no trademarks, every one related to an existing
  term), 56 regular plurals. Result: 843 forms = 554 canonical + 289 inflections (34.3 %); difficulty after review 27.3 / 35.7 /
  28.3 / 8.7 %; categories 10.3–13.5 %; 3–4 letters 192. The 2–4-letter share is 27.2 % (was 29.7 %), still above
  the 20–25 % steering band: batch 2 adds longer canonical terms first.
- **C-LC-3 Closed verb list for batch 2 (60 verbs; a verb form is authored only on an existing canonical term with
  that verb reading, regular -S/-ED/-ING only unless confirmed as NEEDS_REVIEW, noun reading wins on collisions per
  D-1, and a standalone term owns its string per D-5, e.g. LOGGING, STREAMING):** DEPLOY, COMMIT, MERGE, PUSH, PULL,
  FORK, CLONE, REBASE, FETCH, BRANCH, TAG, BUILD, COMPILE, DEBUG, TEST, LINT, MOCK, REFACTOR, PARSE, RELEASE, PATCH,
  INSTALL, UPDATE, UPGRADE, DOWNLOAD, UPLOAD, SYNC, STREAM, CACHE, HASH, ENCRYPT, DECRYPT, LOG, PING, ROUTE, BOOT,
  REBOOT, CRASH, SCALE, MIGRATE, PROVISION, THROTTLE, QUERY, INDEX, SORT, FILTER, JOIN, SHARD, REPLICATE, RESTORE,
  TRAIN, TOKENIZE, PROMPT, EMBED, LABEL, HACK, SPOOF, STAGE, FORMAT, ENCODE. Irregular pasts (BUILT) are not
  authored.
- **C-LC-4 Blocklist source: original curator-written lists, no third-party dataset.** `en.txt` (135 entries) and
  `fr.txt` (82 entries) were written from editorial knowledge: ethnic/racial/religious slurs, slurs about sexual
  orientation, gender identity and disability, hate/extremist terms, sexual terms and sexual violence, profanity and
  insults, offensive abbreviations (WTF, KYS, FDP, NTM, PD…). No list was copied, so no licence applies and H-1 is
  not needed (widely used public word lists are CC-BY or unlicensed, i.e. not allowlisted). Principles: exact forms
  only (ANALYTICS stays playable), never block identity words that are not slurs (GAY, QUEER, TRANS), and do not
  block strings whose tech meaning is primary (QUEUE, CHAT, CRACKER, KNOB, CP, POS); such cases are listed in the
  file headers. Manual review of all 213 forms of 2–4 letters (canonical + inflections) in EN and FR: no offensive
  reading found; ROM/ROMS kept (in French "Roms" is a neutral ethnonym, the tech reading is primary). Before any
  public release: a second native-speaker review of both lists (FR incl. Senegal usage), tracked as NEEDS_REVIEW.
- **C-LC-5 Mass nouns and D-5 conflicts.** No plural for: uncountable nouns (MALWARE, SOFTWARE, DATA, STORAGE,
  FIRMWARE, BANDWIDTH, SPAM, CODE, RAM, MEMORY), gerunds (PHISHING, LOGGING, STREAMING, TRAINING), abstract
  -ITY/-TION/-ISM nouns (SCALABILITY, ENCRYPTION, REPLICATION, POLYMORPHISM), service models (SAAS, IAAS, PAAS,
  FAAS), protocols, formats and standards named as one system (HTTP, TCP, JSON, USB, HTML, XML), data units
  (KB, MB, GB, TB), product and language terms (validator, D-6), and trademarked tools (DOCKER, KAFKA, TERRAFORM).
  Two-letter terms get a plural only with real usage and no conflict (DBS, PCS, PRS, VMS). Irregular plurals
  confirmed by the curator (their `NEEDS_REVIEW` warnings are accepted, not open): INDICES, QUERIES, LIBRARIES,
  BATTERIES, PROXIES, VULNERABILITIES. D-5 audit of the seed: no declared plural equals a canonical form; IDS is the
  standalone intrusion detection system, so ID declares no plural; IPS (intrusion prevention system), NATS (NATS
  messaging) and CIS are reserved for possible standalone terms, so IP, NAT and CI declare none; IOS is Apple's iOS;
  MICE/MOUSES are not declared (ambiguous).

## LEGAL_REVIEW_REQUIRED

- Use of product names and trademarks as playable forms and in definitions (nominative use) before any **public**
  release; acceptable for the internal playtest. ASSUMPTION: nominative use with `owner` attribution and no
  endorsement is sufficient for an adults-only internal playtest.
- Licence of the blocklist dataset if it is not on the allowlist (e.g. CC-BY-4.0).

## Human follow-ups

- H-1 Approve a non-allowlisted licence for the blocklist dataset, only if no allowlisted dataset covering EN and FR
  is found (C-LC-4).
- H-2 None other blocks design; the 11×11 fallback decision stays governed by BALANCE.md on simulator evidence.

## Test traceability

| AC | Test(s) |
|---|---|
| AC-1, AC-3, AC-4, AC-5, AC-6 | `packages/lexicon/test/validate.test.mjs`: one passing fixture and one failing fixture per rule (uniqueness across files, form = inflection, regex, own form, enum, non-playable owner, product/language owner, unsorted, duplicate, > 4, blocklisted inflection, warnings) |
| AC-2 | Migration test: v1 and v2 playable sets equal; mixed-version rejection fixture |
| AC-7 | Snapshot test of the JSON report on the fixture lexicon |
| AC-8, AC-11 | T-COMPLETE / T-SOUND / T-ORACLE with inflection fixtures (lexicon-index note §7); bots move-generation fixture includes an inflection |
| AC-9, AC-10 | Engine golden cases (plural main word, hook cross-word, POD → PODS chain, KUBERNETES → PODS chain) in `docs/game/RULE_PROPERTIES.md`; property: score of a form = score computed with its canonical term's difficulty |
| AC-12 | E-1.5 component tests: chip dedupe, "New to you" by canonical id, "Played as" line EN/FR |
| AC-13, AC-14, AC-15, AC-16 | Validator report checked by `qa-engineer` at Q1 and at each batch; curator checklist in each PR |
| AC-17 | Blocklist fixture test; PR checklist of the 2–4-letter review |
| AC-18 | Engine replay test across two lexicon versions; `LEXICON_MISMATCH` test |
| AC-19 | Fixture: blocklisting a data form fails validation; version changes after removal |
| AC-20 | Simulator readout file per batch linked from the sprint file |
| AC-21 | Helper script unit test: deterministic output, no writes, skips product/language/collisions |
