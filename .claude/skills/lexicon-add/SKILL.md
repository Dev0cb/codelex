---
name: lexicon-add
description: Add, correct or relate technology terms in the CODELEX Lexicon (packages/lexicon/data) with EN/FR definitions, difficulty, aliases, typed relations and computed game values, then validate. Use for any lexicon content work, season word packs, mission word lists or org-restricted dictionaries.
argument-hint: "<category and/or list of terms>"
---

# Lexicon add

Request: $ARGUMENTS

1. Delegate to `lexicon-curator`. Read `docs/game/LEXICON_SPEC.md` and existing terms of the category to avoid
   duplicates (`grep -ri '"form": "<TERM>"' packages/lexicon/data`).
2. For each term: canonical id (kebab-case), `form` (A–Z, 2–15), `display`, category(ies), difficulty per rubric,
   EN/FR original definitions ≤ 160 chars, aliases, typed relations (targets must exist or be added in the same
   batch), `kind`, `sources` (official docs URLs). Game value & knowledge XP are **computed** by the validator's
   formula — do not hand-set unless `game-designer` approved an override.
3. Run `pnpm lexicon:validate`. Fix every error. Re-run until clean.
4. Report: terms added/updated by difficulty, new relations, `NEEDS_REVIEW` items, validator output.
