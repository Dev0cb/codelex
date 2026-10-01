# 0008 — AI: deterministic bots in-house; Claude API for Coach and content tooling

- Status: Accepted · Date: 2026-10-01 · Reversibility: Two-way door

## Context
AI opponents must be fast, cheap, reproducible and fair; the Coach and content tooling need language
understanding and generation.

## Decision
- **Bots**: in-house search over the GADDAG index (`packages/bots`), seeded and time-boxed; no LLM in gameplay.
- **LLM features**: Claude API via `@anthropic-ai/sdk`, default model `claude-opus-5-5`, adaptive thinking,
  effort tuned per route by evals, structured outputs validated with zod, `stop_reason` (incl. `refusal`)
  handled, prompt caching, Batch API for offline lexicon drafting. Model or effort changes for cost go through an
  eval and an ADR amendment.
- **Embeddings**: provider chosen by an eval on related-term retrieval quality (follow-up ADR); stored in pgvector.
- Human review is mandatory for any AI-drafted lexicon content before publish.

## Consequences
Game fully functional when the AI service is down; per-user/global cost budgets; prompts and eval sets versioned
in `services/ai`.
