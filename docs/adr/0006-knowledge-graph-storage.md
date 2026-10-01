# 0006 — Knowledge Graph in PostgreSQL adjacency tables + pgvector (graph DB deferred)

- Status: Accepted · Date: 2026-10-01 · Reversibility: Two-way door

## Context
The Knowledge Graph (V-14) needs typed relations, depth-2/3 traversals, chain generation and semantic search.
Expected size at maturity: 10⁵–10⁶ terms, 10⁶–10⁷ edges — comfortably within Postgres.

## Options considered
- **A. Postgres adjacency (`term_relation`) + recursive CTEs + pgvector** — one less system, transactional with
  the lexicon, good enough for bounded-depth queries.
- **B. Neo4j / Neptune** — expressive traversals, extra system to operate and keep consistent.

## Decision
A, with traversal APIs encapsulated in `services/knowledge` so storage can change without clients noticing.
Hot subgraphs cached in Redis; game-time lookups use the in-memory GADDAG index, never the DB.

## Consequences
Revisit if depth-3 query p95 > 50 ms at scale or if graph analytics needs exceed SQL.
